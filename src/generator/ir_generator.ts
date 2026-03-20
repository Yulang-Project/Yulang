// src/generator/ir_generator.ts

import {
    ASTNode, type ExprVisitor, type StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, IndexExpr, AssignExpr, ThisExpr, AsExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, AddressOfExpr, DereferenceExpr, FunctionLiteralExpr, ArrayLiteralExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, UsingStmt, PointerTypeAnnotation, FunctionTypeAnnotation
} from '../ast.js';
import { Token, TokenType } from '../token.js';
import { LLVMIRHelper } from './llvm_ir_helpers.js';
import { Parser } from '../parser/index.js';
import * as path from 'path';
import * as process from 'process';
import { BuiltinFunctions, resolveLangItemType } from './builtins.js';
import { LangItems } from './lang_items.js';
import { findPredefinedFunction } from '../predefine/funs.js';
import { LLVM, LLVMIntPredicate, LLVMTypeKind } from '../llvm/index.js';
import type { LLVMModuleRef, LLVMBuilderRef, LLVMValueRef, LLVMTypeRef, LLVMBasicBlockRef } from '../llvm/index.js';

export type IRValue = { 
    value: LLVMValueRef, 
    type: LLVMTypeRef, 
    address?: LLVMValueRef,
    pointeeType?: LLVMTypeRef
};

type SymbolEntry = {
    llvmType: LLVMTypeRef;
    ptr: LLVMValueRef;
    definedInScopeDepth: number;
};

class Scope {
    private symbols: Map<string, SymbolEntry> = new Map();
    constructor(public parent: Scope | null = null, public depth: number = 0) { }

    define(name: string, entry: SymbolEntry): boolean {
        if (this.symbols.has(name)) return false;
        this.symbols.set(name, entry);
        return true;
    }

    find(name: string): SymbolEntry | null {
        return this.symbols.get(name) || this.parent?.find(name) || null;
    }
}

export class IRGenerator implements ExprVisitor<IRValue>, StmtVisitor<void> {
    public builder: LLVMBuilderRef;
    public module: LLVMModuleRef;
    public llvmHelper: LLVMIRHelper = new LLVMIRHelper();
    public builtins: BuiltinFunctions;
    public indentLevel: number = 0;

    private globalScope: Scope = new Scope(null, 0);
    public currentScope: Scope = this.globalScope;
    private currentFunction: FunctionDeclaration | null = null;
    private sourceFilePath: string;
    private debug: boolean;
    private pass: 'declaration' | 'definition' = 'declaration';
    public platform: any;
    private labelCounter: number = 0;
    public stringStructType: LLVMTypeRef = null as any;

    constructor(platform: any, parser: Parser, mangleStdLib: boolean = true, sourceFilePath: string = '', debug: boolean = true) {
        this.platform = platform;
        this.sourceFilePath = sourceFilePath;
        this.debug = debug;
        this.builtins = new BuiltinFunctions(this.llvmHelper);
        this.llvmHelper.setGenerator(this);
        
        const context = this.llvmHelper.getContext();
        this.module = LLVM.ModuleCreateWithNameInContext(sourceFilePath, context);
        this.builder = LLVM.CreateBuilderInContext(context);

        const triple = platform.getTargetTriple ? platform.getTargetTriple() : "x86_64-pc-linux-gnu";
        LLVM.SetTarget(this.module, triple);
        LLVM.SetDataLayout(this.module, platform.getDataLayout ? platform.getDataLayout() : "");
        
        this.emitLangItemStructs();
    }

    public getModule(): LLVMModuleRef { return this.module; }

    public emit(ir: string, indent: boolean = true): void { }

    private emitLangItemStructs(): void {
        const context = this.llvmHelper.getContext();
        
        // Object struct
        this.objectStructType = LLVM.StructCreateNamed(context, LangItems.object.structName);
        LLVM.StructSetBody(this.objectStructType, [], 0, 0);

        // String struct
        const stringElements = [
            LLVM.PointerType(LLVM.Int8TypeInContext(context), 0), // ptr
            LLVM.Int64TypeInContext(context)                    // length
        ];
        this.stringStructType = LLVM.StructCreateNamed(context, LangItems.string.structName);
        LLVM.StructSetBody(this.stringStructType, stringElements, stringElements.length, 0);
        
        (this.llvmHelper as any).namedStructs.set(LangItems.string.structName, this.stringStructType);
        (this.llvmHelper as any).namedStructs.set(LangItems.object.structName, this.objectStructType);
    }

    private objectStructType: LLVMTypeRef = null as any;

    public generate(nodes: ASTNode[]): string {
        this.pass = 'declaration';
        nodes.forEach(node => { if (node instanceof Stmt) node.accept(this); });

        // If no explicit main function is found, we might want to create an implicit one for top-level code
        let hasMain = LLVM.GetNamedFunction(this.module, "main");
        if (!hasMain && this.pass === 'declaration') {
             const context = this.llvmHelper.getContext();
             const i32Type = LLVM.Int32TypeInContext(context);
             const funcType = LLVM.FunctionType(i32Type, [], 0, 0);
             const mainFunc = LLVM.AddFunction(this.module, "main", funcType);
             const entryBlock = LLVM.AppendBasicBlockInContext(context, mainFunc, "entry");
             LLVM.PositionBuilderAtEnd(this.builder, entryBlock);
        }

        this.pass = 'definition';
        nodes.forEach(node => { 
            if (node instanceof Stmt) {
                node.accept(this);
            }
        });

        // Simple check for main return
        const mainFunc = LLVM.GetNamedFunction(this.module, "main");
        if (mainFunc) {
            // We just build a return 0 at the end regardless for simplicity in this transformation
            // This might create redundant returns but LLVM handles it.
            LLVM.BuildRet(this.builder, LLVM.ConstInt(LLVM.Int32TypeInContext(this.llvmHelper.getContext()), 0n as any, 0));
        }

        return LLVM.PrintModuleToString(this.module);
    }

    public getNewLabel(prefix: string): string { return `${prefix}.${this.labelCounter++}`; }
    public ensureHeapGlobals(): void { }
    public ensureStringPointer(val: IRValue): IRValue { return val; }

    private enterScope() { this.currentScope = new Scope(this.currentScope, this.currentScope.depth + 1); }
    private exitScope() { if (this.currentScope.parent) this.currentScope = this.currentScope.parent; }

    // --- Expression Visitors ---

    visitLiteralExpr(expr: LiteralExpr): IRValue {
        const context = this.llvmHelper.getContext();
        if (typeof expr.value === 'number') {
            const i64Type = LLVM.Int64TypeInContext(context);
            return { value: LLVM.ConstInt(i64Type, BigInt(expr.value) as any, 1), type: i64Type };
        }
        if (typeof expr.value === 'string') {
            const entry = this.llvmHelper.createGlobalString(expr.value);
            const structType = this.stringStructType;
            // Load the struct value from the global variable
            const loadedStruct = LLVM.BuildLoad2(this.builder, structType, entry.stringStructGlobal, "str_val");
            return { value: loadedStruct, type: structType, address: entry.stringStructGlobal };
        }
        if (typeof expr.value === 'boolean') {
            const i1Type = LLVM.Int1TypeInContext(context);
            return { value: LLVM.ConstInt(i1Type, expr.value ? 1n : 0n as any, 0), type: i1Type };
        }
        return { value: null as any, type: LLVM.VoidTypeInContext(context) };
    }

    visitBinaryExpr(expr: BinaryExpr): IRValue {
        const left = expr.left.accept(this);
        const right = expr.right.accept(this);
        const context = this.llvmHelper.getContext();

        switch (expr.operator.type) {
            case TokenType.PLUS: return { value: LLVM.BuildAdd(this.builder, left.value, right.value, ""), type: left.type };
            case TokenType.MINUS: return { value: LLVM.BuildSub(this.builder, left.value, right.value, ""), type: left.type };
            case TokenType.STAR: return { value: LLVM.BuildMul(this.builder, left.value, right.value, ""), type: left.type };
            case TokenType.SLASH: return { value: LLVM.BuildSDiv(this.builder, left.value, right.value, ""), type: left.type };
            case TokenType.EQ_EQ: return { value: LLVM.BuildICmp(this.builder, LLVMIntPredicate.LLVMIntEQ, left.value, right.value, ""), type: LLVM.Int1TypeInContext(context) };
            default: throw new Error(`Unsupported binary operator: ${expr.operator.lexeme}`);
        }
    }

    visitIdentifierExpr(expr: IdentifierExpr): IRValue {
        const name = expr.name.lexeme;
        if (name === 'syscall') {
            return { value: null as any, type: null as any, address: null as any };
        }
        const entry = this.currentScope.find(name);
        if (!entry) throw new Error(`Undefined identifier: ${name}`);
        const typeKind = LLVM.GetTypeKind(entry.llvmType);
        if (typeKind === 9) return { value: entry.ptr, type: LLVM.PointerType(entry.llvmType, 0), pointeeType: entry.llvmType };
        const loadedValue = LLVM.BuildLoad2(this.builder, entry.llvmType, entry.ptr, name);
        return { value: loadedValue, type: entry.llvmType, address: entry.ptr };
    }

    visitCallExpr(expr: CallExpr): IRValue {
        const callee = expr.callee.accept(this);
        let funcType = callee.pointeeType;
        
        // Handle argument passing for variadic functions or normal ones
        const args = expr.args.map(arg => {
            const val = arg.accept(this);
            // Auto-convert string literal to char* if calling clib
            if (expr.callee instanceof GetExpr && expr.callee.object instanceof IdentifierExpr && expr.callee.object.name.lexeme === 'clib') {
                if (val.type === this.stringStructType || val.pointeeType === this.stringStructType) {
                     // Extract the char pointer
                     const ptr = val.address || val.value;
                     const i8PtrType = LLVM.PointerType(LLVM.Int8TypeInContext(this.llvmHelper.getContext()), 0);
                     const dataPtrAddr = LLVM.BuildStructGEP2(this.builder, this.stringStructType, ptr, 0, "ptr_addr");
                     return LLVM.BuildLoad2(this.builder, i8PtrType, dataPtrAddr, "ptr_val");
                }
            }
            return val.value;
        });

        if (!funcType) {
            throw new Error(`Cannot determine function type for call.`);
        }

        const result = LLVM.BuildCall2(this.builder, funcType, callee.value, args, args.length, "");
        return { value: result, type: LLVM.GetReturnType(funcType) };
    }

    visitAsExpr(expr: AsExpr): IRValue {
        const val = expr.expression.accept(this);
        const targetType = this.llvmHelper.getLLVMType(expr.type);
        return this.coerceValue(val, targetType);
    }

    visitIndexExpr(expr: IndexExpr): IRValue {
        const arrayInfo = expr.array.accept(this);
        const indexInfo = expr.index.accept(this);
        const arrayPtr = arrayInfo.address || arrayInfo.value;
        const arrayStructType = arrayInfo.type;
        const dataFieldPtr = LLVM.BuildStructGEP2(this.builder, arrayStructType, arrayPtr, 0, "");
        const dataPtrType = LLVM.GetElementType(LLVM.TypeOf(dataFieldPtr));
        const dataPtr = LLVM.BuildLoad2(this.builder, dataPtrType, dataFieldPtr, "data_ptr");
        const elementType = LLVM.GetElementType(dataPtrType);
        const indexValue = this.ensureI64(indexInfo);
        const elementPtr = LLVM.BuildInBoundsGEP2(this.builder, elementType, dataPtr, [indexValue], 1, "element_ptr");
        const loadedValue = LLVM.BuildLoad2(this.builder, elementType, elementPtr, "index_val");
        return { value: loadedValue, type: elementType, address: elementPtr };
    }

    visitArrayLiteralExpr(expr: ArrayLiteralExpr): IRValue {
        const elements = expr.elements.map(e => e.accept(this));
        const context = this.llvmHelper.getContext();
        const elementType = (elements.length > 0 && elements[0]) ? elements[0].type : LLVM.Int64TypeInContext(context);
        const arrayStructType = this.llvmHelper.ensureArrayStructDefinition(elementType);
        const arrayPtr = LLVM.BuildAlloca(this.builder, arrayStructType, "arr_ptr");
        const dataFieldPtr = LLVM.BuildStructGEP2(this.builder, arrayStructType, arrayPtr, 0, "");
        LLVM.BuildStore(this.builder, LLVM.ConstPointerNull(LLVM.PointerType(elementType, 0)), dataFieldPtr);
        const loadedArray = LLVM.BuildLoad2(this.builder, arrayStructType, arrayPtr, "arr");
        return { value: loadedArray, type: arrayStructType, address: arrayPtr };
    }

    // --- Statement Visitors ---
    visitLetStmt(stmt: LetStmt): void { this.visitLocalLetStmt(stmt); }
    visitLocalLetStmt(stmt: LetStmt): void {
        const llvmType = this.llvmHelper.getLLVMType(stmt.type);
        const varPtr = LLVM.BuildAlloca(this.builder, llvmType, stmt.name.lexeme);
        this.currentScope.define(stmt.name.lexeme, { llvmType, ptr: varPtr, definedInScopeDepth: this.currentScope.depth });
        if (stmt.initializer) {
            const val = stmt.initializer.accept(this);
            const coerced = this.coerceValue(val, llvmType);
            LLVM.BuildStore(this.builder, coerced.value, varPtr);
        }
    }

    visitFunctionDeclaration(decl: FunctionDeclaration): void {
        const originalFuncName = decl.name.lexeme;
        const context = this.llvmHelper.getContext();
        const llvmReturnType = this.llvmHelper.getLLVMType(decl.returnType);
        const paramTypes = decl.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
        const funcType = LLVM.FunctionType(llvmReturnType, paramTypes, paramTypes.length, 0);

        if (this.pass === 'declaration') {
            const func = LLVM.AddFunction(this.module, originalFuncName, funcType);
            this.globalScope.define(originalFuncName, { llvmType: funcType, ptr: func, definedInScopeDepth: 0 });
        } else {
            this.currentFunction = decl;
            const entry = this.globalScope.find(originalFuncName);
            const func = entry!.ptr;
            const entryBlock = LLVM.AppendBasicBlockInContext(context, func, "entry");
            LLVM.PositionBuilderAtEnd(this.builder, entryBlock);
            this.enterScope();
            decl.parameters.forEach((p, i) => {
                const pType = this.llvmHelper.getLLVMType(p.type);
                const alloca = LLVM.BuildAlloca(this.builder, pType, p.name.lexeme);
                LLVM.BuildStore(this.builder, LLVM.GetParam(func, i), alloca);
                this.currentScope.define(p.name.lexeme, { llvmType: pType, ptr: alloca, definedInScopeDepth: this.currentScope.depth });
            });
            decl.body.statements.forEach(s => s.accept(this));
            if (LLVM.GetTypeKind(llvmReturnType) === 0) LLVM.BuildRetVoid(this.builder);
            this.exitScope();
            this.currentFunction = null;
        }
    }

    visitReturnStmt(stmt: ReturnStmt): void {
        if (stmt.value) {
            const val = stmt.value.accept(this);
            const expectedType = this.llvmHelper.getLLVMType(this.currentFunction!.returnType);
            const coerced = this.coerceValue(val, expectedType);
            LLVM.BuildRet(this.builder, coerced.value);
        } else {
            LLVM.BuildRetVoid(this.builder);
        }
    }

    visitBlockStmt(stmt: BlockStmt): void { this.enterScope(); stmt.statements.forEach(s => s.accept(this)); this.exitScope(); }
    visitExpressionStmt(stmt: ExpressionStmt): void { stmt.expression.accept(this); }
    visitImportStmt(stmt: ImportStmt): void { }

    // --- Helpers ---
    public ensureI64(val: IRValue): LLVMValueRef {
        const i64Type = LLVM.Int64TypeInContext(this.llvmHelper.getContext());
        const typeKind = LLVM.GetTypeKind(val.type);
        if (typeKind === 12) return LLVM.BuildPtrToInt(this.builder, val.value, i64Type, "");
        if (LLVM.GetIntTypeWidth(val.type) === 64) return val.value;
        return LLVM.BuildSExt(this.builder, val.value, i64Type, "");
    }

    public coerceValue(val: IRValue, targetType: LLVMTypeRef): IRValue {
        if (val.type === targetType) return val;
        const srcKind = LLVM.GetTypeKind(val.type);
        const dstKind = LLVM.GetTypeKind(targetType);
        if (srcKind === 12 && dstKind === 8) return { value: LLVM.BuildPtrToInt(this.builder, val.value, targetType, ""), type: targetType };
        if (srcKind === 8 && dstKind === 12) return { value: LLVM.BuildIntToPtr(this.builder, val.value, targetType, ""), type: targetType };
        return { value: LLVM.BuildBitCast(this.builder, val.value, targetType, ""), type: targetType };
    }

    visitUnaryExpr(expr: UnaryExpr): IRValue { throw new Error("Unimplemented"); }
    visitGroupingExpr(expr: GroupingExpr): IRValue { return expr.expression.accept(this); }
    visitGetExpr(expr: GetExpr): IRValue {
        const context = this.llvmHelper.getContext();
        
        // Handle clib.xxx
        if (expr.object instanceof IdentifierExpr && expr.object.name.lexeme === 'clib') {
            const funcName = expr.name.lexeme;
            let func = LLVM.GetNamedFunction(this.module, funcName);
            if (!func) {
                // For clib, we declare it as a variadic function returning i32 by default
                const i32Type = LLVM.Int32TypeInContext(context);
                const funcType = LLVM.FunctionType(i32Type, [], 0, 1); // i32(...)
                func = LLVM.AddFunction(this.module, funcName, funcType);
            }
            // Manually define the function type since we can't GetElementType
            const i32Type = LLVM.Int32TypeInContext(context);
            const funcType = LLVM.FunctionType(i32Type, [], 0, 1);
            return { value: func, type: LLVM.TypeOf(func), pointeeType: funcType };
        }

        const obj = expr.object.accept(this);
        const objType = obj.type;

        // Handle string.length and string.ptr
        if (objType === this.stringStructType || obj.pointeeType === this.stringStructType) {
            const ptr = obj.address || obj.value;
            if (expr.name.lexeme === 'length') {
                const lenPtr = LLVM.BuildStructGEP2(this.builder, this.stringStructType, ptr, 1, "len_ptr");
                const i64Type = LLVM.Int64TypeInContext(context);
                return { value: LLVM.BuildLoad2(this.builder, i64Type, lenPtr, "len"), type: i64Type };
            }
            if (expr.name.lexeme === 'ptr') {
                const dataPtr = LLVM.BuildStructGEP2(this.builder, this.stringStructType, ptr, 0, "data_ptr");
                const i8PtrType = LLVM.PointerType(LLVM.Int8TypeInContext(context), 0);
                return { value: LLVM.BuildLoad2(this.builder, i8PtrType, dataPtr, "ptr"), type: i8PtrType };
            }
        }

        throw new Error(`Property access for ${expr.name.lexeme} not fully implemented yet.`);
    }
    visitAssignExpr(expr: AssignExpr): IRValue { throw new Error("Unimplemented"); }
    visitThisExpr(expr: ThisExpr): IRValue { throw new Error("Unimplemented"); }
    visitObjectLiteralExpr(expr: ObjectLiteralExpr): IRValue { throw new Error("Unimplemented"); }
    visitNewExpr(expr: NewExpr): IRValue { throw new Error("Unimplemented"); }
    visitDeleteExpr(expr: DeleteExpr): IRValue { throw new Error("Unimplemented"); }
    visitAddressOfExpr(expr: AddressOfExpr): IRValue { throw new Error("Unimplemented"); }
    visitDereferenceExpr(expr: DereferenceExpr): IRValue { throw new Error("Unimplemented"); }
    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): IRValue { throw new Error("Unimplemented"); }
    visitConstStmt(stmt: ConstStmt): void { throw new Error("Unimplemented"); }
    visitIfStmt(stmt: IfStmt): void { throw new Error("Unimplemented"); }
    visitWhileStmt(stmt: WhileStmt): void { throw new Error("Unimplemented"); }
    visitClassDeclaration(decl: ClassDeclaration): void { throw new Error("Unimplemented"); }
    visitStructDeclaration(decl: StructDeclaration): void { throw new Error("Unimplemented"); }
    visitPropertyDeclaration(stmt: PropertyDeclaration): void { }
    visitDeclareFunction(decl: DeclareFunction): void { this.visitFunctionDeclaration(decl as any); }
    visitUsingStmt(stmt: UsingStmt): void { }
}
