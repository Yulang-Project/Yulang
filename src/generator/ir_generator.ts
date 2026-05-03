// src/generator/ir_generator.ts
import {
    ASTNode, type ExprVisitor, type StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, IndexExpr, AssignExpr, ThisExpr, AsExpr, AwaitExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, AddressOfExpr, DereferenceExpr, FunctionLiteralExpr, ArrayLiteralExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction, UsingStmt,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation, PromiseTypeAnnotation
} from '../ast.js';
import { Token, TokenType } from '../token.js';
import { LLVMIRHelper } from './llvm_ir_helpers.js';
import { Parser } from '../parser/index.js';
import { LangItems } from './lang_items.js';
import { LLVM, LLVMIntPredicate } from '../llvm/index.js';
import type { LLVMModuleRef, LLVMBuilderRef, LLVMValueRef, LLVMTypeRef } from '../llvm/index.js';

export type IRValue = { 
    value: LLVMValueRef, 
    type: LLVMTypeRef, 
    address?: LLVMValueRef,
    pointeeType?: LLVMTypeRef,
    extra?: { isMethod?: boolean; methodName?: string; className?: string; closureFunctionType?: LLVMTypeRef; closureParamTypes?: LLVMTypeRef[]; closureReturnType?: LLVMTypeRef; functionParamTypes?: LLVMTypeRef[]; functionReturnType?: LLVMTypeRef; promiseValueType?: LLVMTypeRef; }
};

type SymbolEntry = { llvmType: LLVMTypeRef; ptr: LLVMValueRef; depth: number; pointeeType?: LLVMTypeRef; closureFunctionType?: LLVMTypeRef; closureParamTypes?: LLVMTypeRef[]; closureReturnType?: LLVMTypeRef; functionParamTypes?: LLVMTypeRef[]; functionReturnType?: LLVMTypeRef; promiseValueType?: LLVMTypeRef; };
type CaptureEntry = { name: string; symbol: SymbolEntry; };

class Scope {
    public symbols: Map<string, SymbolEntry> = new Map();
    constructor(public parent: Scope | null = null, public depth: number = 0) { }
    define(name: string, entry: SymbolEntry) { this.symbols.set(name, entry); }
    find(name: string): SymbolEntry | null { return this.symbols.get(name) || this.parent?.find(name) || null; }
}

export class IRGenerator implements ExprVisitor<IRValue>, StmtVisitor<void> {
    public builder: LLVMBuilderRef;
    public module: LLVMModuleRef;
    public llvmHelper: LLVMIRHelper = new LLVMIRHelper();
    private currentScope: Scope = new Scope();
    private globalScope: Scope = this.currentScope;
    public stringStructType: LLVMTypeRef = null as any;
    private objectStructType: LLVMTypeRef = null as any;
    private pass: 'declaration' | 'definition' = 'declaration';
    private namespaceImports: Map<string, Map<string, string>>;
    private currentFunctionReturnType: LLVMTypeRef | null = null;
    private currentFunctionName: string | null = null;
    public indentLevel: number = 0;
    private labelCounter: number = 0;
    private mangle: boolean;
    private classes: Map<string, ClassDeclaration> = new Map();
    private wrappedMainDeclaration: FunctionDeclaration | null = null;
    private currentClosureEnvType: LLVMTypeRef | null = null;
    private currentClosureEnvPtr: LLVMValueRef | null = null;
    private currentClosureCaptures: CaptureEntry[] = [];

    constructor(public platform: any, parser: Parser, mangle: boolean, path: string, debug: boolean) {
        this.mangle = mangle;
        const context = this.llvmHelper.getContext();
        this.module = LLVM.ModuleCreateWithNameInContext(path, context);
        this.builder = LLVM.CreateBuilderInContext(context);
        this.namespaceImports = parser.namespaceImports;
        this.llvmHelper.setGenerator(this);
        this.emitLangItemStructs();
    }

    private resolveSymbolValue(name: string): IRValue {
        const entry = this.currentScope.find(name);
        if (!entry) throw new Error(`Unknown identifier: ${name}`);
        const kind = LLVM.GetTypeKind(entry.llvmType);
        if (kind === 11 || kind === 9) {
            return {
                value: entry.ptr,
                type: LLVM.PointerType(entry.llvmType, 0),
                pointeeType: entry.llvmType,
                extra: entry.functionParamTypes ? {
                    functionParamTypes: entry.functionParamTypes,
                    functionReturnType: entry.functionReturnType
                } : undefined
            };
        }
        return {
            value: LLVM.BuildLoad2(this.builder, entry.llvmType, entry.ptr, name),
            type: entry.llvmType,
            address: entry.ptr,
            pointeeType: entry.pointeeType,
            extra: entry.closureFunctionType ? {
                closureFunctionType: entry.closureFunctionType,
                closureParamTypes: entry.closureParamTypes,
                closureReturnType: entry.closureReturnType
            } : entry.promiseValueType ? {
                promiseValueType: entry.promiseValueType
            } : undefined
        };
    }

    private allocateCell(type: LLVMTypeRef, name: string): LLVMValueRef {
        const ctx = this.llvmHelper.getContext();
        const raw = this.buildGCMalloc(LLVM.SizeOf(type), `${name}_cell_raw`);
        return LLVM.BuildBitCast(this.builder, raw, LLVM.PointerType(type, 0), `${name}_cell`);
    }

    private toPtrArr(arr: any[]) { return arr; }
    public emit(ir: string, indent: boolean = true) {}
    public getNewLabel(prefix: string) { return `${prefix}.${this.labelCounter++}`; }
    public getModule() { return this.module; }

    private isIntegerLikeType(type: LLVMTypeRef): boolean {
        const ctx = this.llvmHelper.getContext();
        if (LLVM.GetTypeKind(type) === 8) {
            return true;
        }
        return type === LLVM.Int1TypeInContext(ctx)
            || type === LLVM.Int8TypeInContext(ctx)
            || type === LLVM.Int16TypeInContext(ctx)
            || type === LLVM.Int32TypeInContext(ctx)
            || type === LLVM.Int64TypeInContext(ctx);
    }

    private coerceToType(v: IRValue, targetType: LLVMTypeRef, name: string = ""): LLVMValueRef {
        if (v.type === targetType) return v.value;

        if (this.isIntegerLikeType(v.type) && this.isIntegerLikeType(targetType)) {
            const sourceWidth = LLVM.GetIntTypeWidth(v.type);
            const targetWidth = LLVM.GetIntTypeWidth(targetType);
            if (sourceWidth > targetWidth) return LLVM.BuildTrunc(this.builder, v.value, targetType, name);
            if (sourceWidth < targetWidth) return LLVM.BuildSExt(this.builder, v.value, targetType, name);
            return v.value;
        }

        if (LLVM.GetTypeKind(v.type) === 12 && LLVM.GetTypeKind(targetType) === 12) {
            return LLVM.BuildPointerCast(this.builder, v.value, targetType, name);
        }

        return LLVM.BuildBitCast(this.builder, v.value, targetType, name);
    }

    private getGCInitFunction(): LLVMValueRef {
        const ctx = this.llvmHelper.getContext();
        const ft = LLVM.FunctionType(LLVM.VoidTypeInContext(ctx), this.toPtrArr([]), 0, 0);
        let fn = LLVM.GetNamedFunction(this.module, "GC_init");
        if (!fn) fn = LLVM.AddFunction(this.module, "GC_init", ft);
        return fn;
    }

    private emitGCInit() {
        const ctx = this.llvmHelper.getContext();
        const ft = LLVM.FunctionType(LLVM.VoidTypeInContext(ctx), this.toPtrArr([]), 0, 0);
        LLVM.BuildCall2(this.builder, ft, this.getGCInitFunction(), this.toPtrArr([]), 0, "");
    }

    private getUVInitFunction(): { fn: LLVMValueRef; type: LLVMTypeRef } {
        const ctx = this.llvmHelper.getContext();
        const ft = LLVM.FunctionType(LLVM.VoidTypeInContext(ctx), this.toPtrArr([]), 0, 0);
        let fn = LLVM.GetNamedFunction(this.module, "yu_uv_init");
        if (!fn) fn = LLVM.AddFunction(this.module, "yu_uv_init", ft);
        return { fn, type: ft };
    }

    private getUVRunFunction(): { fn: LLVMValueRef; type: LLVMTypeRef } {
        const ctx = this.llvmHelper.getContext();
        const ft = LLVM.FunctionType(LLVM.Int32TypeInContext(ctx), this.toPtrArr([]), 0, 0);
        let fn = LLVM.GetNamedFunction(this.module, "yu_uv_run");
        if (!fn) fn = LLVM.AddFunction(this.module, "yu_uv_run", ft);
        return { fn, type: ft };
    }

    private emitRuntimeInit() {
        this.emitGCInit();
        const uvInit = this.getUVInitFunction();
        LLVM.BuildCall2(this.builder, uvInit.type, uvInit.fn, this.toPtrArr([]), 0, "");
    }

    private emitUVRun() {
        const uvRun = this.getUVRunFunction();
        LLVM.BuildCall2(this.builder, uvRun.type, uvRun.fn, this.toPtrArr([]), 0, "");
    }

    private getGCMallocFunction(): { fn: LLVMValueRef; type: LLVMTypeRef } {
        const ctx = this.llvmHelper.getContext();
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        const ft = LLVM.FunctionType(i8Ptr, this.toPtrArr([LLVM.Int64TypeInContext(ctx)]), 1, 0);
        let fn = LLVM.GetNamedFunction(this.module, "GC_malloc");
        if (!fn) fn = LLVM.AddFunction(this.module, "GC_malloc", ft);
        return { fn, type: ft };
    }

    private getGCReallocFunction(): { fn: LLVMValueRef; type: LLVMTypeRef } {
        const ctx = this.llvmHelper.getContext();
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        const ft = LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr, LLVM.Int64TypeInContext(ctx)]), 2, 0);
        let fn = LLVM.GetNamedFunction(this.module, "GC_realloc");
        if (!fn) fn = LLVM.AddFunction(this.module, "GC_realloc", ft);
        return { fn, type: ft };
    }

    private buildGCMalloc(size: LLVMValueRef, name: string): LLVMValueRef {
        const gcMalloc = this.getGCMallocFunction();
        return LLVM.BuildCall2(this.builder, gcMalloc.type, gcMalloc.fn, this.toPtrArr([size]), 1, name);
    }

    private buildGCRealloc(ptr: LLVMValueRef, size: LLVMValueRef, name: string): LLVMValueRef {
        const gcRealloc = this.getGCReallocFunction();
        return LLVM.BuildCall2(this.builder, gcRealloc.type, gcRealloc.fn, this.toPtrArr([ptr, size]), 2, name);
    }

    private getFunctionTypeAnnotation(parameters: Parameter[], returnType: TypeAnnotation | null): FunctionTypeAnnotation {
        const ctx = this.llvmHelper.getContext();
        const voidToken = new Token(TokenType.IDENTIFIER, 'void', null, 0, 0);
        return new FunctionTypeAnnotation(
            parameters.map(p => p.type ?? new BasicTypeAnnotation(new Token(TokenType.I64, 'i64', null, 0, 0))),
            returnType ?? new BasicTypeAnnotation(voidToken)
        );
    }

    private getClosureMetadata(type: TypeAnnotation | null): { functionType?: LLVMTypeRef; paramTypes?: LLVMTypeRef[]; returnType?: LLVMTypeRef } {
        if (!(type instanceof FunctionTypeAnnotation)) return {};
        const closureType = this.llvmHelper.getLLVMType(type);
        const functionType = this.llvmHelper.getClosureFunctionType(closureType) ?? undefined;
        return {
            functionType,
            paramTypes: type.parameters.map(p => this.llvmHelper.getLLVMType(p)),
            returnType: this.llvmHelper.getLLVMType(type.returnType)
        };
    }

    private collectCaptures(expr: FunctionLiteralExpr): CaptureEntry[] {
        const params = new Set(expr.parameters.map(p => p.name.lexeme));
        const locals = new Set<string>(params);
        const captures = new Map<string, CaptureEntry>();

        const visitExpr = (node: Expr) => {
            if (node instanceof IdentifierExpr) {
                const name = node.name.lexeme;
                if (!locals.has(name)) {
                    const symbol = this.currentScope.find(name);
                    if (symbol && symbol.depth > 0) captures.set(name, { name, symbol });
                }
                return;
            }
            if (node instanceof FunctionLiteralExpr) return;
            if (node instanceof BinaryExpr) { visitExpr(node.left); visitExpr(node.right); return; }
            if (node instanceof UnaryExpr) { visitExpr(node.right); return; }
            if (node instanceof GroupingExpr) { visitExpr(node.expression); return; }
            if (node instanceof CallExpr) { visitExpr(node.callee); node.args.forEach(visitExpr); return; }
            if (node instanceof GetExpr) { visitExpr(node.object); return; }
            if (node instanceof IndexExpr) { visitExpr(node.array); visitExpr(node.index); return; }
            if (node instanceof AssignExpr) { visitExpr(node.target); visitExpr(node.value); return; }
            if (node instanceof AsExpr) { visitExpr(node.expression); return; }
            if (node instanceof ObjectLiteralExpr) { node.properties.forEach(visitExpr); return; }
            if (node instanceof NewExpr) { visitExpr(node.callee); node.args.forEach(visitExpr); return; }
            if (node instanceof DeleteExpr) { visitExpr(node.target); return; }
            if (node instanceof AddressOfExpr) { visitExpr(node.expression); return; }
            if (node instanceof DereferenceExpr) { visitExpr(node.expression); return; }
            if (node instanceof ArrayLiteralExpr) { node.elements.forEach(visitExpr); return; }
        };

        const visitStmt = (node: Stmt) => {
            if (node instanceof LetStmt || node instanceof ConstStmt) {
                if (node.initializer) visitExpr(node.initializer);
                locals.add(node.name.lexeme);
                return;
            }
            if (node instanceof ExpressionStmt) { visitExpr(node.expression); return; }
            if (node instanceof ReturnStmt) { if (node.value) visitExpr(node.value); return; }
            if (node instanceof BlockStmt) { node.statements.forEach(visitStmt); return; }
            if (node instanceof IfStmt) {
                visitExpr(node.condition);
                visitStmt(node.thenBranch);
                if (node.elseBranch) visitStmt(node.elseBranch);
                return;
            }
            if (node instanceof WhileStmt) { visitExpr(node.condition); visitStmt(node.body); return; }
        };

        expr.body.statements.forEach(visitStmt);
        return Array.from(captures.values());
    }

    private getGlobalCStringPtr(value: string): LLVMValueRef {
        const entry = this.llvmHelper.createGlobalString(value) as any;
        const ctx = this.llvmHelper.getContext();
        const zero = LLVM.ConstInt(LLVM.Int32TypeInContext(ctx), 0, 0);
        return LLVM.ConstInBoundsGEP2(entry.charArrayType, entry.charPtrGlobal, this.toPtrArr([zero, zero]), 2);
    }

    private castIntegerLikeToString(v: IRValue): IRValue {
        const ctx = this.llvmHelper.getContext();
        const i64 = LLVM.Int64TypeInContext(ctx);
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);

        let numericValue = v.value;
        if (v.type !== i64) {
            numericValue = LLVM.BuildSExt(this.builder, v.value, i64, "to_i64");
        }

        const bufferSize = LLVM.ConstInt(i64, 64n as any, 0);
        const bufferPtr = this.buildGCMalloc(bufferSize, 'strbuf');

        const sprintfType = LLVM.FunctionType(LLVM.Int32TypeInContext(ctx), this.toPtrArr([i8Ptr, i8Ptr]), 2, 1);
        let sprintfFn = LLVM.GetNamedFunction(this.module, 'sprintf');
        if (!sprintfFn) sprintfFn = LLVM.AddFunction(this.module, 'sprintf', sprintfType);
        const intFormat = this.getGlobalCStringPtr("%lld");
        LLVM.BuildCall2(this.builder, sprintfType, sprintfFn, this.toPtrArr([bufferPtr, intFormat, numericValue]), 3, '');

        const strlenType = LLVM.FunctionType(i64, this.toPtrArr([i8Ptr]), 1, 0);
        let strlenFn = LLVM.GetNamedFunction(this.module, 'strlen');
        if (!strlenFn) strlenFn = LLVM.AddFunction(this.module, 'strlen', strlenType);
        const lenValue = LLVM.BuildCall2(this.builder, strlenType, strlenFn, this.toPtrArr([bufferPtr]), 1, 'strlen');

        const stringPtr = LLVM.BuildAlloca(this.builder, this.stringStructType, 'string_cast');
        LLVM.BuildStore(this.builder, bufferPtr, LLVM.BuildStructGEP2(this.builder, this.stringStructType, stringPtr, 0, ''));
        LLVM.BuildStore(this.builder, lenValue, LLVM.BuildStructGEP2(this.builder, this.stringStructType, stringPtr, 1, ''));

        return {
            value: LLVM.BuildLoad2(this.builder, this.stringStructType, stringPtr, 'str_cast'),
            type: this.stringStructType,
            address: stringPtr
        };
    }

    private toCStringPointer(v: IRValue): LLVMValueRef {
        const ctx = this.llvmHelper.getContext();
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        if (v.type === this.stringStructType || v.pointeeType === this.stringStructType) {
            return LLVM.BuildLoad2(this.builder, i8Ptr, LLVM.BuildStructGEP2(this.builder, this.stringStructType, v.address || v.value, 0, ""), "p");
        }
        return v.value;
    }

    private buildStringStructFromPtrLen(ptr: LLVMValueRef, len: LLVMValueRef): IRValue {
        const stringPtr = LLVM.BuildAlloca(this.builder, this.stringStructType, 'string_from_ptr');
        LLVM.BuildStore(this.builder, ptr, LLVM.BuildStructGEP2(this.builder, this.stringStructType, stringPtr, 0, ''));
        LLVM.BuildStore(this.builder, len, LLVM.BuildStructGEP2(this.builder, this.stringStructType, stringPtr, 1, ''));
        return {
            value: LLVM.BuildLoad2(this.builder, this.stringStructType, stringPtr, 'str_val'),
            type: this.stringStructType,
            address: stringPtr
        };
    }

    private buildStringArrayFromArgv(argc: LLVMValueRef, argv: LLVMValueRef): IRValue {
        const ctx = this.llvmHelper.getContext();
        const i8 = LLVM.Int8TypeInContext(ctx);
        const i8Ptr = LLVM.PointerType(i8, 0);
        const i64 = LLVM.Int64TypeInContext(ctx);
        const i32 = LLVM.Int32TypeInContext(ctx);
        const arrayType = this.llvmHelper.ensureArrayStructDefinition(this.stringStructType);
        const arrayPtr = LLVM.BuildAlloca(this.builder, arrayType, "args");

        const argc64 = LLVM.BuildSExt(this.builder, argc, i64, "argc64");
        const byteSize = LLVM.BuildMul(this.builder, argc64, LLVM.SizeOf(this.stringStructType), "args_bytes");
        const rawData = this.buildGCMalloc(byteSize, "args_raw");
        const dataPtr = LLVM.BuildBitCast(this.builder, rawData, LLVM.PointerType(this.stringStructType, 0), "args_data");
        LLVM.BuildStore(this.builder, dataPtr, LLVM.BuildStructGEP2(this.builder, arrayType, arrayPtr, 0, ""));
        LLVM.BuildStore(this.builder, argc64, LLVM.BuildStructGEP2(this.builder, arrayType, arrayPtr, 1, ""));
        LLVM.BuildStore(this.builder, argc64, LLVM.BuildStructGEP2(this.builder, arrayType, arrayPtr, 2, ""));

        const strlenType = LLVM.FunctionType(i64, this.toPtrArr([i8Ptr]), 1, 0);
        let strlenFn = LLVM.GetNamedFunction(this.module, "strlen");
        if (!strlenFn) strlenFn = LLVM.AddFunction(this.module, "strlen", strlenType);

        const functionPtr = LLVM.GetBasicBlockParent(LLVM.GetInsertBlock(this.builder));
        const condBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "argv_cond");
        const bodyBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "argv_body");
        const endBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "argv_end");
        const indexPtr = LLVM.BuildAlloca(this.builder, i32, "argv_i");
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i32, 0n as any, 0), indexPtr);
        LLVM.BuildBr(this.builder, condBB);

        LLVM.PositionBuilderAtEnd(this.builder, condBB);
        const index = LLVM.BuildLoad2(this.builder, i32, indexPtr, "argv_i_val");
        const keepGoing = LLVM.BuildICmp(this.builder, LLVMIntPredicate.LLVMIntSLT, index, argc, "argv_has_next");
        LLVM.BuildCondBr(this.builder, keepGoing, bodyBB, endBB);

        LLVM.PositionBuilderAtEnd(this.builder, bodyBB);
        const argvSlot = LLVM.BuildInBoundsGEP2(this.builder, i8Ptr, argv, this.toPtrArr([index]), 1, "argv_slot");
        const rawArg = LLVM.BuildLoad2(this.builder, i8Ptr, argvSlot, "argv_raw");
        const argLen = LLVM.BuildCall2(this.builder, strlenType, strlenFn, this.toPtrArr([rawArg]), 1, "argv_len");
        const index64 = LLVM.BuildSExt(this.builder, index, i64, "argv_i64");
        const stringSlot = LLVM.BuildInBoundsGEP2(this.builder, this.stringStructType, dataPtr, this.toPtrArr([index64]), 1, "arg_slot");
        LLVM.BuildStore(this.builder, rawArg, LLVM.BuildStructGEP2(this.builder, this.stringStructType, stringSlot, 0, ""));
        LLVM.BuildStore(this.builder, argLen, LLVM.BuildStructGEP2(this.builder, this.stringStructType, stringSlot, 1, ""));
        const nextIndex = LLVM.BuildAdd(this.builder, index, LLVM.ConstInt(i32, 1n as any, 0), "argv_i_next");
        LLVM.BuildStore(this.builder, nextIndex, indexPtr);
        LLVM.BuildBr(this.builder, condBB);

        LLVM.PositionBuilderAtEnd(this.builder, endBB);
        return {
            value: LLVM.BuildLoad2(this.builder, arrayType, arrayPtr, "args_value"),
            type: arrayType,
            address: arrayPtr,
            pointeeType: arrayType
        };
    }

    private emitMainWrapper(d: FunctionDeclaration) {
        const ctx = this.llvmHelper.getContext();
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        const i32 = LLVM.Int32TypeInContext(ctx);
        const argvType = LLVM.PointerType(i8Ptr, 0);
        const mainType = LLVM.FunctionType(i32, this.toPtrArr([i32, argvType]), 2, 0);
        const mainFn = LLVM.AddFunction(this.module, "main", mainType);
        LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(ctx, mainFn, "entry"));
        this.emitGCInit();

        const argc = LLVM.GetParam(mainFn, 0);
        const argv = LLVM.GetParam(mainFn, 1);
        const argsArray = this.buildStringArrayFromArgv(argc, argv);
        const yuMain = LLVM.GetNamedFunction(this.module, "yu_main");
        const yuMainType = this.llvmHelper.getLLVMType(d.returnType);
        const paramTypes = d.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
        const yuMainFunctionType = LLVM.FunctionType(yuMainType, this.toPtrArr(paramTypes), paramTypes.length, 0);
        const callArgs = d.parameters.length === 2 ? [argc, argsArray.value] : [argsArray.value];
        const result = LLVM.BuildCall2(this.builder, yuMainFunctionType, yuMain, this.toPtrArr(callArgs), callArgs.length, "yu_main_result");
        const returnValue = yuMainType === i32 ? result : this.coerceToType({ value: result, type: yuMainType }, i32, "main_ret");
        this.emitUVRun();
        LLVM.BuildRet(this.builder, returnValue);
    }

    private emitClibReadFile(pathArg: IRValue): IRValue {
        const ctx = this.llvmHelper.getContext();
        const i8 = LLVM.Int8TypeInContext(ctx);
        const i8Ptr = LLVM.PointerType(i8, 0);
        const i64 = LLVM.Int64TypeInContext(ctx);
        const i32 = LLVM.Int32TypeInContext(ctx);

        const fopenType = LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr, i8Ptr]), 2, 0);
        let fopenFn = LLVM.GetNamedFunction(this.module, 'fopen');
        if (!fopenFn) fopenFn = LLVM.AddFunction(this.module, 'fopen', fopenType);

        const fseekType = LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i64, i32]), 3, 0);
        let fseekFn = LLVM.GetNamedFunction(this.module, 'fseek');
        if (!fseekFn) fseekFn = LLVM.AddFunction(this.module, 'fseek', fseekType);

        const ftellType = LLVM.FunctionType(i64, this.toPtrArr([i8Ptr]), 1, 0);
        let ftellFn = LLVM.GetNamedFunction(this.module, 'ftell');
        if (!ftellFn) ftellFn = LLVM.AddFunction(this.module, 'ftell', ftellType);

        const freadType = LLVM.FunctionType(i64, this.toPtrArr([i8Ptr, i64, i64, i8Ptr]), 4, 0);
        let freadFn = LLVM.GetNamedFunction(this.module, 'fread');
        if (!freadFn) freadFn = LLVM.AddFunction(this.module, 'fread', freadType);

        const fcloseType = LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0);
        let fcloseFn = LLVM.GetNamedFunction(this.module, 'fclose');
        if (!fcloseFn) fcloseFn = LLVM.AddFunction(this.module, 'fclose', fcloseType);

        const pathPtr = this.toCStringPointer(pathArg);
        const readMode = this.getGlobalCStringPtr('rb');
        const filePtr = LLVM.BuildCall2(this.builder, fopenType, fopenFn, this.toPtrArr([pathPtr, readMode]), 2, 'file_read');

        LLVM.BuildCall2(this.builder, fseekType, fseekFn, this.toPtrArr([filePtr, LLVM.ConstInt(i64, 0n as any, 0), LLVM.ConstInt(i32, 2n as any, 0)]), 3, '');
        const fileLen = LLVM.BuildCall2(this.builder, ftellType, ftellFn, this.toPtrArr([filePtr]), 1, 'file_len');
        LLVM.BuildCall2(this.builder, fseekType, fseekFn, this.toPtrArr([filePtr, LLVM.ConstInt(i64, 0n as any, 0), LLVM.ConstInt(i32, 0n as any, 0)]), 3, '');

        const allocSize = LLVM.BuildAdd(this.builder, fileLen, LLVM.ConstInt(i64, 1n as any, 0), 'alloc_size');
        const buffer = this.buildGCMalloc(allocSize, 'file_buf');

        LLVM.BuildCall2(this.builder, freadType, freadFn, this.toPtrArr([buffer, LLVM.ConstInt(i64, 1n as any, 0), fileLen, filePtr]), 4, '');
        const endPtr = LLVM.BuildInBoundsGEP2(this.builder, i8, buffer, this.toPtrArr([fileLen]), 1, 'end_ptr');
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i8, 0n as any, 0), endPtr);

        LLVM.BuildCall2(this.builder, fcloseType, fcloseFn, this.toPtrArr([filePtr]), 1, '');
        return this.buildStringStructFromPtrLen(buffer, fileLen);
    }

    private emitClibWriteFile(pathArg: IRValue, contentArg: IRValue, append: boolean): IRValue {
        const ctx = this.llvmHelper.getContext();
        const i8 = LLVM.Int8TypeInContext(ctx);
        const i8Ptr = LLVM.PointerType(i8, 0);
        const i64 = LLVM.Int64TypeInContext(ctx);
        const i32 = LLVM.Int32TypeInContext(ctx);

        const fopenType = LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr, i8Ptr]), 2, 0);
        let fopenFn = LLVM.GetNamedFunction(this.module, 'fopen');
        if (!fopenFn) fopenFn = LLVM.AddFunction(this.module, 'fopen', fopenType);

        const strlenType = LLVM.FunctionType(i64, this.toPtrArr([i8Ptr]), 1, 0);
        let strlenFn = LLVM.GetNamedFunction(this.module, 'strlen');
        if (!strlenFn) strlenFn = LLVM.AddFunction(this.module, 'strlen', strlenType);

        const fwriteType = LLVM.FunctionType(i64, this.toPtrArr([i8Ptr, i64, i64, i8Ptr]), 4, 0);
        let fwriteFn = LLVM.GetNamedFunction(this.module, 'fwrite');
        if (!fwriteFn) fwriteFn = LLVM.AddFunction(this.module, 'fwrite', fwriteType);

        const fcloseType = LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0);
        let fcloseFn = LLVM.GetNamedFunction(this.module, 'fclose');
        if (!fcloseFn) fcloseFn = LLVM.AddFunction(this.module, 'fclose', fcloseType);

        const pathPtr = this.toCStringPointer(pathArg);
        const contentPtr = this.toCStringPointer(contentArg);
        const modePtr = this.getGlobalCStringPtr(append ? 'ab' : 'wb');

        const filePtr = LLVM.BuildCall2(this.builder, fopenType, fopenFn, this.toPtrArr([pathPtr, modePtr]), 2, 'file_write');
        const len = LLVM.BuildCall2(this.builder, strlenType, strlenFn, this.toPtrArr([contentPtr]), 1, 'content_len');
        const wrote = LLVM.BuildCall2(this.builder, fwriteType, fwriteFn, this.toPtrArr([contentPtr, LLVM.ConstInt(i64, 1n as any, 0), len, filePtr]), 4, 'wrote');
        LLVM.BuildCall2(this.builder, fcloseType, fcloseFn, this.toPtrArr([filePtr]), 1, '');
        return { value: LLVM.BuildTrunc(this.builder, wrote, i32, 'wrote_i32'), type: i32 };
    }

    private emitClibReadFileAsync(pathArg: IRValue, callbackArg: IRValue): IRValue {
        const ctx = this.llvmHelper.getContext();
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        const i32 = LLVM.Int32TypeInContext(ctx);
        const ft = LLVM.FunctionType(i32, this.toPtrArr([this.stringStructType, i8Ptr, i8Ptr]), 3, 0);
        let readFileFn = LLVM.GetNamedFunction(this.module, 'yu_fs_readFile');
        if (!readFileFn) readFileFn = LLVM.AddFunction(this.module, 'yu_fs_readFile', ft);

        const closureType = callbackArg.type;
        const closurePtr = callbackArg.address ?? LLVM.BuildAlloca(this.builder, closureType, "read_file_cb_tmp");
        if (!callbackArg.address) LLVM.BuildStore(this.builder, callbackArg.value, closurePtr);

        const codePtrType = LLVM.StructGetTypeAtIndex(closureType, 0);
        const codePtr = LLVM.BuildLoad2(this.builder, codePtrType, LLVM.BuildStructGEP2(this.builder, closureType, closurePtr, 0, "read_file_cb_code_slot"), "read_file_cb_code");
        const envPtr = LLVM.BuildLoad2(this.builder, i8Ptr, LLVM.BuildStructGEP2(this.builder, closureType, closurePtr, 1, "read_file_cb_env_slot"), "read_file_cb_env");
        const codeAsPtr = LLVM.BuildPointerCast(this.builder, codePtr, i8Ptr, "read_file_cb_code_ptr");

        return {
            value: LLVM.BuildCall2(this.builder, ft, readFileFn, this.toPtrArr([pathArg.value, codeAsPtr, envPtr]), 3, "read_file_status"),
            type: i32
        };
    }

    private emitClibReadFilePromise(pathArg: IRValue): IRValue {
        const ctx = this.llvmHelper.getContext();
        const promiseType = this.llvmHelper.getLLVMType(new PromiseTypeAnnotation(new BasicTypeAnnotation(new Token(TokenType.STRING, 'string', null, 0, 0))));
        const ft = LLVM.FunctionType(promiseType, this.toPtrArr([this.stringStructType]), 1, 0);
        let readFilePromiseFn = LLVM.GetNamedFunction(this.module, 'yu_fs_readFilePromise');
        if (!readFilePromiseFn) readFilePromiseFn = LLVM.AddFunction(this.module, 'yu_fs_readFilePromise', ft);
        return {
            value: LLVM.BuildCall2(this.builder, ft, readFilePromiseFn, this.toPtrArr([pathArg.value]), 1, "read_file_promise"),
            type: promiseType,
            extra: { promiseValueType: this.stringStructType }
        };
    }

    private getClibFunctionType(name: string): LLVMTypeRef {
        const ctx = this.llvmHelper.getContext();
        const i8 = LLVM.Int8TypeInContext(ctx);
        const i8Ptr = LLVM.PointerType(i8, 0);
        const i32 = LLVM.Int32TypeInContext(ctx);
        const i64 = LLVM.Int64TypeInContext(ctx);
        const f64 = LLVM.DoubleTypeInContext(ctx);
        const voidType = LLVM.VoidTypeInContext(ctx);

        const table: { [key: string]: () => LLVMTypeRef } = {
            printf: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 1),
            sprintf: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i8Ptr]), 2, 1),
            puts: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0),
            strlen: () => LLVM.FunctionType(i64, this.toPtrArr([i8Ptr]), 1, 0),
            strcmp: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i8Ptr]), 2, 0),
            strncmp: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i8Ptr, i64]), 3, 0),

            open: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i32, i32]), 3, 0),
            read: () => LLVM.FunctionType(i64, this.toPtrArr([i32, i8Ptr, i64]), 3, 0),
            write: () => LLVM.FunctionType(i64, this.toPtrArr([i32, i8Ptr, i64]), 3, 0),
            close: () => LLVM.FunctionType(i32, this.toPtrArr([i32]), 1, 0),

            fopen: () => LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr, i8Ptr]), 2, 0),
            fread: () => LLVM.FunctionType(i64, this.toPtrArr([i8Ptr, i64, i64, i8Ptr]), 4, 0),
            fwrite: () => LLVM.FunctionType(i64, this.toPtrArr([i8Ptr, i64, i64, i8Ptr]), 4, 0),
            fseek: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i64, i32]), 3, 0),
            ftell: () => LLVM.FunctionType(i64, this.toPtrArr([i8Ptr]), 1, 0),
            fclose: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0),
            fflush: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0),

            malloc: () => LLVM.FunctionType(i8Ptr, this.toPtrArr([i64]), 1, 0),
            realloc: () => LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr, i64]), 2, 0),
            free: () => LLVM.FunctionType(voidType, this.toPtrArr([i8Ptr]), 1, 0),
            GC_init: () => LLVM.FunctionType(voidType, this.toPtrArr([]), 0, 0),
            GC_malloc: () => LLVM.FunctionType(i8Ptr, this.toPtrArr([i64]), 1, 0),
            GC_realloc: () => LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr, i64]), 2, 0),
            GC_free: () => LLVM.FunctionType(voidType, this.toPtrArr([i8Ptr]), 1, 0),
            readFile: () => LLVM.FunctionType(i32, this.toPtrArr([this.stringStructType, i8Ptr, i8Ptr]), 3, 0),

            exit: () => LLVM.FunctionType(voidType, this.toPtrArr([i32]), 1, 0),
            system: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0),
            getenv: () => LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr]), 1, 0),

            abs: () => LLVM.FunctionType(i32, this.toPtrArr([i32]), 1, 0),
            sqrt: () => LLVM.FunctionType(f64, this.toPtrArr([f64]), 1, 0),
            pow: () => LLVM.FunctionType(f64, this.toPtrArr([f64, f64]), 2, 0),
            sin: () => LLVM.FunctionType(f64, this.toPtrArr([f64]), 1, 0),
            cos: () => LLVM.FunctionType(f64, this.toPtrArr([f64]), 1, 0),
            tan: () => LLVM.FunctionType(f64, this.toPtrArr([f64]), 1, 0),
            floor: () => LLVM.FunctionType(f64, this.toPtrArr([f64]), 1, 0),
            ceil: () => LLVM.FunctionType(f64, this.toPtrArr([f64]), 1, 0),

            time: () => LLVM.FunctionType(i64, this.toPtrArr([i8Ptr]), 1, 0),
            getchar: () => LLVM.FunctionType(i32, this.toPtrArr([]), 0, 0),
            putchar: () => LLVM.FunctionType(i32, this.toPtrArr([i32]), 1, 0),

            access: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i32]), 2, 0),
            unlink: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0),
            rename: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i8Ptr]), 2, 0),
            mkdir: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i32]), 2, 0),
            rmdir: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0),
            chmod: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i32]), 2, 0),
            chown: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i32, i32]), 3, 0),
            getcwd: () => LLVM.FunctionType(i8Ptr, this.toPtrArr([i8Ptr, i64]), 2, 0),
            chdir: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr]), 1, 0),

            readfile: () => LLVM.FunctionType(this.stringStructType, this.toPtrArr([i8Ptr]), 1, 0),
            writefile: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i8Ptr]), 2, 0),
            appendfile: () => LLVM.FunctionType(i32, this.toPtrArr([i8Ptr, i8Ptr]), 2, 0),
        };

        const factory = table[name];
        if (factory) return factory();

        return LLVM.FunctionType(i32, this.toPtrArr([]), 0, 1);
    }

    private shouldWrapMain(d: FunctionDeclaration): boolean {
        return this.mangle && d.name.lexeme === 'main' && d.parameters.length > 0;
    }

    private isStringType(type: TypeAnnotation | null): boolean {
        return type instanceof BasicTypeAnnotation && type.name.lexeme === 'string';
    }

    private isStringArrayType(type: TypeAnnotation | null): boolean {
        return type instanceof ArrayTypeAnnotation && this.isStringType(type.elementType);
    }

    private validateWrappedMainSignature(d: FunctionDeclaration) {
        const valid = (d.parameters.length === 1 && this.isStringArrayType(d.parameters[0]?.type ?? null))
            || (d.parameters.length === 2
                && d.parameters[0]?.type instanceof BasicTypeAnnotation
                && d.parameters[0].type.name.lexeme === 'i32'
                && this.isStringArrayType(d.parameters[1]?.type ?? null));

        if (!valid) {
            throw new Error("main with parameters must be main(args: array<string>) or main(argc: i32, args: array<string>).");
        }
    }

    private getClassMethodType(className: string, method: FunctionDeclaration): LLVMTypeRef {
        const structType = this.llvmHelper.getLLVMTypeByName(`struct.${className}`);
        const rt = this.llvmHelper.getLLVMType(method.returnType);
        const pts = [LLVM.PointerType(structType, 0), ...method.parameters.map(p => this.llvmHelper.getLLVMType(p.type))];
        return LLVM.FunctionType(rt, this.toPtrArr(pts), pts.length, 0);
    }

    private emitLangItemStructs() {
        const ctx = this.llvmHelper.getContext();
        this.objectStructType = LLVM.StructCreateNamed(ctx, LangItems.object.structName);
        LLVM.StructSetBody(this.objectStructType, this.toPtrArr([LLVM.Int8TypeInContext(ctx)]), 1, 0);
        const strEl = [LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0), LLVM.Int64TypeInContext(ctx)];
        this.stringStructType = LLVM.StructCreateNamed(ctx, LangItems.string.structName);
        LLVM.StructSetBody(this.stringStructType, this.toPtrArr(strEl), 2, 0);
        (this.llvmHelper as any).namedStructs.set(LangItems.string.structName, this.stringStructType);
        (this.llvmHelper as any).namedStructs.set(LangItems.object.structName, this.objectStructType);
    }

    public generate(nodes: ASTNode[]): string {
        ['declaration', 'definition'].forEach(p => {
            this.pass = p as any;
            nodes.forEach(n => { if (n instanceof Stmt) n.accept(this); });
            if (p === 'declaration' && !LLVM.GetNamedFunction(this.module, "main") && !this.wrappedMainDeclaration) {
                const i32 = LLVM.Int32TypeInContext(this.llvmHelper.getContext());
                const main = LLVM.AddFunction(this.module, "main", LLVM.FunctionType(i32, this.toPtrArr([]), 0, 0));
                LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(this.llvmHelper.getContext(), main, "entry"));
                this.emitRuntimeInit();
                LLVM.BuildRet(this.builder, LLVM.ConstInt(i32, 0n as any, 0));
            }
        });
        if (this.wrappedMainDeclaration) {
            this.emitMainWrapper(this.wrappedMainDeclaration);
        }
        return LLVM.PrintModuleToString(this.module);
    }

    visitLiteralExpr(expr: LiteralExpr): IRValue {
        const ctx = this.llvmHelper.getContext();
        if (typeof expr.value === 'number') {
            const i64 = LLVM.Int64TypeInContext(ctx);
            return { value: LLVM.ConstInt(i64, BigInt(expr.value) as any, 1), type: i64 };
        }
        if (typeof expr.value === 'string') {
            const e = this.llvmHelper.createGlobalString(expr.value);
            return { value: LLVM.BuildLoad2(this.builder, this.stringStructType, e.stringStructGlobal, "s"), type: this.stringStructType, address: e.stringStructGlobal };
        }
        return { value: LLVM.ConstInt(LLVM.Int1TypeInContext(ctx), expr.value ? 1n : 0n as any, 0), type: LLVM.Int1TypeInContext(ctx) };
    }

    visitIdentifierExpr(expr: IdentifierExpr): IRValue {
        return this.resolveSymbolValue(expr.name.lexeme);
    }

    visitGetExpr(expr: GetExpr): IRValue {
        const ctx = this.llvmHelper.getContext();
        if (expr.object instanceof IdentifierExpr) {
            const namespaceAlias = expr.object.name.lexeme;
            const namespaceMap = this.namespaceImports.get(namespaceAlias);
            if (namespaceMap) {
                const importedSymbolName = namespaceMap.get(expr.name.lexeme);
                if (!importedSymbolName) {
                    throw new Error(`Namespace '${namespaceAlias}' has no export named '${expr.name.lexeme}'.`);
                }
                return this.resolveSymbolValue(importedSymbolName);
            }
        }

        if (expr.object instanceof IdentifierExpr && expr.object.name.lexeme === 'clib') {
            const ft = this.getClibFunctionType(expr.name.lexeme);
            let f = LLVM.GetNamedFunction(this.module, expr.name.lexeme);
            if (!f) f = LLVM.AddFunction(this.module, expr.name.lexeme, ft);
            return { value: f, type: LLVM.TypeOf(f), pointeeType: ft };
        }
        const obj = expr.object.accept(this) as IRValue;
        const ptr = LLVM.GetTypeKind(obj.type) === 12 ? obj.value : (obj.address || obj.value);
        const isStr = (obj.type === this.stringStructType || obj.pointeeType === this.stringStructType);
        if (isStr) {
            if (expr.name.lexeme === 'length') return { value: LLVM.BuildLoad2(this.builder, LLVM.Int64TypeInContext(ctx), LLVM.BuildStructGEP2(this.builder, this.stringStructType, ptr, 1, ""), "l"), type: LLVM.Int64TypeInContext(ctx) };
            if (expr.name.lexeme === 'ptr') return { value: LLVM.BuildLoad2(this.builder, LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0), LLVM.BuildStructGEP2(this.builder, this.stringStructType, ptr, 0, ""), "p"), type: LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0) };
        }
        const actualType = (LLVM.GetTypeKind(obj.type) === 12) ? obj.pointeeType : obj.type;
        if (actualType && LLVM.GetTypeKind(actualType) === 10) {
            // Manual lookup based on current class being visited or stored info
            // For now, let's use a simpler way to identify the class
            for (const [className, classDecl] of this.classes) {
                const structType = this.llvmHelper.getLLVMTypeByName(`struct.${className}`);
                if (structType === actualType) {
                    // Check properties
                    const propIndex = classDecl.properties.findIndex(p => p.name.lexeme === expr.name.lexeme);
                    if (propIndex !== -1) {
                        const fieldPtr = LLVM.BuildStructGEP2(this.builder, actualType, ptr, propIndex, "");
                        const fieldType = LLVM.StructGetTypeAtIndex(actualType, propIndex);
                        return { 
                            value: LLVM.BuildLoad2(this.builder, fieldType, fieldPtr, ""), 
                            type: fieldType, 
                            address: fieldPtr 
                        };
                    }
                    // Check methods
                    const method = classDecl.methods.find(m => m.name.lexeme === expr.name.lexeme);
                    if (method) {
                        return { 
                            value: obj.value, 
                            type: obj.type, 
                            address: obj.address, 
                            pointeeType: actualType, 
                            extra: { isMethod: true, methodName: expr.name.lexeme, className } 
                        };
                    }
                }
            }

            if (expr.name.lexeme === 'length') return { value: LLVM.BuildLoad2(this.builder, LLVM.Int64TypeInContext(ctx), LLVM.BuildStructGEP2(this.builder, actualType, ptr, 1, ""), "l"), type: LLVM.Int64TypeInContext(ctx) };
            if (expr.name.lexeme === 'push') return { value: obj.value, type: obj.type, address: obj.address, pointeeType: actualType, extra: { isMethod: true, methodName: 'push' } };
        }
        throw new Error(`Property ${expr.name.lexeme} not found`);
    }

    visitCallExpr(expr: CallExpr): IRValue {
        const ctx = this.llvmHelper.getContext(), callee = expr.callee.accept(this) as IRValue;
        const i64 = LLVM.Int64TypeInContext(ctx), i8p = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        if (expr.callee instanceof GetExpr && expr.callee.object instanceof IdentifierExpr && expr.callee.object.name.lexeme === 'clib') {
            const clibName = expr.callee.name.lexeme;
            if (clibName === 'readfile') {
                const pathArg = expr.args[0]!.accept(this) as IRValue;
                return this.emitClibReadFile(pathArg);
            }
            if (clibName === 'writefile') {
                const pathArg = expr.args[0]!.accept(this) as IRValue;
                const contentArg = expr.args[1]!.accept(this) as IRValue;
                return this.emitClibWriteFile(pathArg, contentArg, false);
            }
            if (clibName === 'appendfile') {
                const pathArg = expr.args[0]!.accept(this) as IRValue;
                const contentArg = expr.args[1]!.accept(this) as IRValue;
                return this.emitClibWriteFile(pathArg, contentArg, true);
            }
            if (clibName === 'readFile') {
                const pathArg = expr.args[0]!.accept(this) as IRValue;
                const callbackArg = expr.args[1]!.accept(this) as IRValue;
                return this.emitClibReadFileAsync(pathArg, callbackArg);
            }
            if (clibName === 'readFilePromise') {
                const pathArg = expr.args[0]!.accept(this) as IRValue;
                return this.emitClibReadFilePromise(pathArg);
            }
        }

        if (callee.extra?.isMethod) {
            const objPtr = LLVM.GetTypeKind(callee.type) === 12 ? callee.value : (callee.address || callee.value);
            const methodName = callee.extra.methodName!;
            
            if (methodName === 'push') {
                const type = callee.pointeeType!, val = expr.args[0]!.accept(this) as IRValue;
                const lPtr = LLVM.BuildStructGEP2(this.builder, type, objPtr, 1, ""), cPtr = LLVM.BuildStructGEP2(this.builder, type, objPtr, 2, "");
                const l = LLVM.BuildLoad2(this.builder, i64, lPtr, ""), c = LLVM.BuildLoad2(this.builder, i64, cPtr, "");
                const isFull = LLVM.BuildICmp(this.builder, LLVMIntPredicate.LLVMIntEQ, l, c, "");
                const f = LLVM.GetBasicBlockParent(LLVM.GetInsertBlock(this.builder)), rBB = LLVM.AppendBasicBlockInContext(ctx, f, "r"), pBB = LLVM.AppendBasicBlockInContext(ctx, f, "p");
                LLVM.BuildCondBr(this.builder, isFull, rBB, pBB);
                LLVM.PositionBuilderAtEnd(this.builder, rBB);
                const nc = LLVM.BuildMul(this.builder, c, LLVM.ConstInt(i64, 2n as any, 0), ""), dfp = LLVM.BuildStructGEP2(this.builder, type, objPtr, 0, "");
                const od = LLVM.BuildLoad2(this.builder, i8p, dfp, "");
                const sizePerElement = LLVM.SizeOf(val.type);
                const nd = this.buildGCRealloc(od, LLVM.BuildMul(this.builder, nc, sizePerElement, ""), "");
                LLVM.BuildStore(this.builder, nd, dfp); LLVM.BuildStore(this.builder, nc, cPtr); LLVM.BuildBr(this.builder, pBB);
                LLVM.PositionBuilderAtEnd(this.builder, pBB);
                const dp = LLVM.BuildLoad2(this.builder, LLVM.PointerType(val.type, 0), LLVM.BuildStructGEP2(this.builder, type, objPtr, 0, ""), "");
                LLVM.BuildStore(this.builder, val.value, LLVM.BuildInBoundsGEP2(this.builder, val.type, dp, this.toPtrArr([l]), 1, ""));
                const nl = LLVM.BuildAdd(this.builder, l, LLVM.ConstInt(i64, 1n as any, 0), "");
                LLVM.BuildStore(this.builder, nl, lPtr); return { value: nl, type: i64 };
            } else if (callee.extra.className) {
                const className = callee.extra.className;
                const classDecl = this.classes.get(className);
                const method = classDecl?.methods.find(m => m.name.lexeme === methodName);
                if (!method) throw new Error(`Method ${className}.${methodName} not found`);
                const mangledName = `yu_class_${className}_${methodName}`;
                const f = LLVM.GetNamedFunction(this.module, mangledName);
                const ft = this.getClassMethodType(className, method);
                const args = [objPtr, ...expr.args.map((a, i) => {
                    const arg = a.accept(this) as IRValue;
                    const paramType = this.llvmHelper.getLLVMType(method.parameters[i]?.type ?? null);
                    return this.coerceToType(arg, paramType, "arg_cast");
                })];
                return { value: LLVM.BuildCall2(this.builder, ft, f, this.toPtrArr(args), args.length, ""), type: LLVM.GetReturnType(ft) };
            }
        }
        const closureFunctionType = callee.extra?.closureFunctionType ?? this.llvmHelper.getClosureFunctionType(callee.type);
        if (closureFunctionType) {
            const closurePtr = callee.address ?? LLVM.BuildAlloca(this.builder, callee.type, "closure_tmp");
            if (!callee.address) LLVM.BuildStore(this.builder, callee.value, closurePtr);
            const codePtrType = LLVM.StructGetTypeAtIndex(callee.type, 0);
            const codePtr = LLVM.BuildLoad2(this.builder, codePtrType, LLVM.BuildStructGEP2(this.builder, callee.type, closurePtr, 0, "closure_code_ptr"), "closure_code");
            const envPtr = LLVM.BuildLoad2(this.builder, i8p, LLVM.BuildStructGEP2(this.builder, callee.type, closurePtr, 1, "closure_env_ptr"), "closure_env");
            const paramTypes = callee.extra?.closureParamTypes ?? [];
            const args = [envPtr, ...expr.args.map((a, i) => {
                const arg = a.accept(this) as IRValue;
                const paramType = paramTypes[i];
                return paramType ? this.coerceToType(arg, paramType, "closure_arg_cast") : arg.value;
            })];
            return {
                value: LLVM.BuildCall2(this.builder, closureFunctionType, codePtr, this.toPtrArr(args), args.length, "closure_call"),
                type: callee.extra?.closureReturnType ?? LLVM.GetReturnType(closureFunctionType)
            };
        }
        const ft = callee.pointeeType; if (!ft) throw new Error("Missing function type");
        const coercedArgs = expr.args.map((a, i) => {
            const v = a.accept(this) as IRValue;
            if (expr.callee instanceof GetExpr && expr.callee.object instanceof IdentifierExpr && expr.callee.object.name.lexeme === 'clib') {
                if (v.type === this.stringStructType || v.pointeeType === this.stringStructType) return LLVM.BuildLoad2(this.builder, i8p, LLVM.BuildStructGEP2(this.builder, this.stringStructType, v.address || v.value, 0, ""), "p");
            }
            const paramType = callee.extra?.functionParamTypes?.[i];
            return paramType ? this.coerceToType(v, paramType, "call_arg_cast") : v.value;
        });
        return { value: LLVM.BuildCall2(this.builder, ft, callee.value, this.toPtrArr(coercedArgs), coercedArgs.length, ""), type: callee.extra?.functionReturnType ?? LLVM.GetReturnType(ft) };
    }

    visitBinaryExpr(e: BinaryExpr): IRValue {
        const l = e.left.accept(this) as IRValue, r = e.right.accept(this) as IRValue;
        if (e.operator.type === TokenType.PLUS) return { value: LLVM.BuildAdd(this.builder, l.value, r.value, ""), type: l.type };
        if (e.operator.type === TokenType.MINUS) return { value: LLVM.BuildSub(this.builder, l.value, r.value, ""), type: l.type };
        if (e.operator.type === TokenType.STAR) return { value: LLVM.BuildMul(this.builder, l.value, r.value, ""), type: l.type };
        if (e.operator.type === TokenType.SLASH) return { value: LLVM.BuildSDiv(this.builder, l.value, r.value, ""), type: l.type };
        return { value: LLVM.BuildICmp(this.builder, LLVMIntPredicate.LLVMIntEQ, l.value, r.value, ""), type: LLVM.Int1TypeInContext(this.llvmHelper.getContext()) };
    }

    visitIndexExpr(e: IndexExpr): IRValue {
        const a = e.array.accept(this) as IRValue, i = e.index.accept(this) as IRValue;
        const at = (LLVM.GetTypeKind(a.type) === 12) ? a.pointeeType! : a.type;
        const ctx = this.llvmHelper.getContext();
        const i64 = LLVM.Int64TypeInContext(ctx);
        
        // Get the pointer type from the first field of the array struct
        const ptrType = LLVM.StructGetTypeAtIndex(at, 0); // This should be ElementType*
        const et = this.llvmHelper.getArrayElementType(at);
        if (!et) throw new Error("Cannot determine array element type.");
        
        const dp = LLVM.BuildLoad2(this.builder, ptrType, LLVM.BuildStructGEP2(this.builder, at, a.address || a.value, 0, ""), "data_ptr");
        const index = this.coerceToType(i, i64, "index_i64");
        const ep = LLVM.BuildInBoundsGEP2(this.builder, et, dp, this.toPtrArr([index]), 1, "element_ptr");
        return { value: LLVM.BuildLoad2(this.builder, et, ep, "element_val"), type: et, address: ep };
    }

    visitArrayLiteralExpr(e: ArrayLiteralExpr): IRValue {
        const ctx = this.llvmHelper.getContext(), els = e.elements.map(el => el.accept(this) as IRValue);
        const et = els[0]?.type || LLVM.Int64TypeInContext(ctx), st = this.llvmHelper.ensureArrayStructDefinition(et);
        const ap = LLVM.BuildAlloca(this.builder, st, "a"), i64 = LLVM.Int64TypeInContext(ctx);
        const cap = BigInt(Math.max(els.length, 4));
        
        const sizePerElement = LLVM.SizeOf(et);
        const totalSize = LLVM.BuildMul(this.builder, LLVM.ConstInt(i64, cap as any, 0), sizePerElement, "total_size");
        const md = this.buildGCMalloc(totalSize, "");
        
        const dp = LLVM.BuildBitCast(this.builder, md, LLVM.PointerType(et, 0), "");
        LLVM.BuildStore(this.builder, dp, LLVM.BuildStructGEP2(this.builder, st, ap, 0, ""));
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i64, BigInt(els.length) as any, 0), LLVM.BuildStructGEP2(this.builder, st, ap, 1, ""));
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i64, cap as any, 0), LLVM.BuildStructGEP2(this.builder, st, ap, 2, ""));
        els.forEach((v, i) => LLVM.BuildStore(this.builder, v.value, LLVM.BuildInBoundsGEP2(this.builder, et, dp, this.toPtrArr([LLVM.ConstInt(i64, BigInt(i) as any, 0)]), 1, "")));
        return { value: LLVM.BuildLoad2(this.builder, st, ap, ""), type: st, address: ap, pointeeType: st };
    }

    visitFunctionDeclaration(d: FunctionDeclaration) {
        let n = d.name.lexeme;
        if (this.shouldWrapMain(d)) {
            this.validateWrappedMainSignature(d);
            n = 'yu_main';
            this.wrappedMainDeclaration = d;
        } else if (this.mangle && n !== 'main') {
            n = `yu_${n}`;
        }
        const ctx = this.llvmHelper.getContext(), rt = this.llvmHelper.getLLVMType(d.returnType), pts = d.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
        const ft = LLVM.FunctionType(rt, this.toPtrArr(pts), pts.length, 0);
        if (this.pass === 'declaration') {
            this.globalScope.define(d.name.lexeme, {
                llvmType: ft,
                ptr: LLVM.AddFunction(this.module, n, ft),
                depth: 0,
                functionParamTypes: pts,
                functionReturnType: rt
            });
        }
        else {
            const f = LLVM.GetNamedFunction(this.module, n); 
            if (!f) throw new Error(`Function ${n} not found during definition pass`);
            LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(ctx, f, "e"));
            const previousFunctionName = this.currentFunctionName;
            const previousFunctionReturnType = this.currentFunctionReturnType;
            this.currentFunctionName = n;
            this.currentFunctionReturnType = rt;
            this.currentScope = new Scope(this.currentScope, 1);
            if (n === 'main') {
                this.emitRuntimeInit();
            }
            d.parameters.forEach((p, i) => {
                const pt = this.llvmHelper.getLLVMType(p.type), a = this.allocateCell(pt, p.name.lexeme);
                LLVM.BuildStore(this.builder, LLVM.GetParam(f, i), a); this.currentScope.define(p.name.lexeme, { llvmType: pt, ptr: a, depth: 1 });
            });
            d.body.statements.forEach(s => s.accept(this));
            if (LLVM.GetTypeKind(rt) === 0) LLVM.BuildRetVoid(this.builder);
            this.currentScope = this.globalScope;
            this.currentFunctionName = previousFunctionName;
            this.currentFunctionReturnType = previousFunctionReturnType;
        }
    }

    visitLetStmt(s: LetStmt) {
        const initializer = s.initializer ? (s.initializer.accept(this) as IRValue) : null;
        const t = s.type ? this.llvmHelper.getLLVMType(s.type) : initializer?.type;
        if (!t) throw new Error(`Variable '${s.name.lexeme}' requires a type annotation or initializer.`);
        const p = this.allocateCell(t, s.name.lexeme);
        const closureMetadata = this.getClosureMetadata(s.type ?? (s.initializer instanceof FunctionLiteralExpr ? this.getFunctionTypeAnnotation(s.initializer.parameters, s.initializer.returnType) : null));
        this.currentScope.define(s.name.lexeme, {
            llvmType: t,
            ptr: p,
            depth: this.currentScope.depth,
            pointeeType: initializer?.pointeeType,
            closureFunctionType: initializer?.extra?.closureFunctionType ?? closureMetadata.functionType,
            closureParamTypes: initializer?.extra?.closureParamTypes ?? closureMetadata.paramTypes,
            closureReturnType: initializer?.extra?.closureReturnType ?? closureMetadata.returnType
        });
        if (initializer) LLVM.BuildStore(this.builder, this.coerceToType(initializer, t, "init_cast"), p);
    }

    visitReturnStmt(s: ReturnStmt) { 
        if (s.value) {
            const ctx = this.llvmHelper.getContext();
            const v = (s.value.accept(this) as IRValue);
            let val = v.value;
            const targetType = this.currentFunctionReturnType;
            const i32 = LLVM.Int32TypeInContext(ctx);
            const i64 = LLVM.Int64TypeInContext(ctx);

            if (targetType) {
                if (targetType === i32 && v.type !== i32 && this.isIntegerLikeType(v.type)) {
                    val = LLVM.BuildTrunc(this.builder, v.value, i32, "ret_to_i32");
                } else if (targetType === i64 && v.type !== i64 && this.isIntegerLikeType(v.type)) {
                    val = LLVM.BuildSExt(this.builder, v.value, i64, "ret_to_i64");
                } else if (v.type !== targetType) {
                    val = this.coerceToType(v, targetType, "ret_cast");
                }
            } else if (this.currentFunctionName === 'main' && this.isIntegerLikeType(v.type) && v.type !== i32) {
                val = LLVM.BuildTrunc(this.builder, v.value, i32, "main_ret_i32");
            }

            if (this.currentFunctionName === 'main') this.emitUVRun();
            LLVM.BuildRet(this.builder, val); 
        } else {
            if (this.currentFunctionName === 'main') this.emitUVRun();
            LLVM.BuildRetVoid(this.builder); 
        }
    }
    visitBlockStmt(s: BlockStmt) { s.statements.forEach(st => st.accept(this)); }
    visitExpressionStmt(s: ExpressionStmt) { s.expression.accept(this); }
    public ensureI64(v: IRValue): LLVMValueRef { return v.value; }
    public coerceValue(v: IRValue, t: LLVMTypeRef): IRValue { return v; }
    visitAsExpr(e: AsExpr): IRValue {
        const value = e.expression.accept(this) as IRValue;
        const targetType = this.llvmHelper.getLLVMType(e.type);

        if (e.type instanceof BasicTypeAnnotation && e.type.name.lexeme === 'string') {
            if (value.type === this.stringStructType || value.pointeeType === this.stringStructType) {
                return value;
            }
            if (this.isIntegerLikeType(value.type)) {
                return this.castIntegerLikeToString(value);
            }
            throw new Error("Unsupported cast to string. Only integer-like types are currently supported.");
        }

        return { value: LLVM.BuildBitCast(this.builder, value.value, targetType, ""), type: targetType };
    }
    visitUnaryExpr(e: UnaryExpr): IRValue {
        const v = e.right.accept(this) as IRValue;
        if (e.operator.type === TokenType.MINUS) {
            if (this.isIntegerLikeType(v.type)) {
                return { value: LLVM.BuildNeg(this.builder, v.value, "neg"), type: v.type };
            }
            if (LLVM.GetTypeKind(v.type) === 3 || LLVM.GetTypeKind(v.type) === 2) { // Double or Float
                return { value: LLVM.BuildFNeg(this.builder, v.value, "fneg"), type: v.type };
            }
        }
        throw new Error(`Unary operator ${e.operator.lexeme} not implemented.`);
    }
    visitGroupingExpr(e: GroupingExpr): IRValue { return e.expression.accept(this) as IRValue; }
    visitAwaitExpr(e: AwaitExpr): IRValue {
        const inner = e.expression.accept(this) as IRValue;
        const promiseValueType = inner.extra?.promiseValueType ?? this.llvmHelper.getPromiseValueType(inner.type);
        if (!promiseValueType) {
            return inner;
        }
        const promiseStructType = this.llvmHelper.getPromiseStructType(inner.type);
        if (!promiseStructType) {
            return inner;
        }
        const valuePtr = LLVM.BuildStructGEP2(this.builder, promiseStructType, inner.value, 0, "promise_value_slot");
        const value = LLVM.BuildLoad2(this.builder, promiseValueType, valuePtr, "await_value");
        return { value, type: promiseValueType };
    }
    visitAssignExpr(e: AssignExpr): IRValue {
        const target = e.target.accept(this) as IRValue;
        const value = e.value.accept(this) as IRValue;
        if (!target.address) throw new Error("Assignment target must have an address");
        LLVM.BuildStore(this.builder, this.coerceToType(value, target.type, "assign_cast"), target.address);
        return value;
    }
    visitThisExpr(e: ThisExpr): IRValue {
        return this.resolveSymbolValue("this");
    }
    visitObjectLiteralExpr(e: ObjectLiteralExpr): IRValue {
        for (const value of e.properties.values()) {
            value.accept(this);
        }

        const ctx = this.llvmHelper.getContext();
        const value = LLVM.ConstNamedStruct(this.objectStructType, this.toPtrArr([
            LLVM.ConstInt(LLVM.Int8TypeInContext(ctx), 0n as any, 0)
        ]), 1);
        return { value, type: this.objectStructType };
    }
    visitNewExpr(e: NewExpr): IRValue {
        const ctx = this.llvmHelper.getContext();
        if (!(e.callee instanceof IdentifierExpr)) throw new Error("New expression must call a class name");
        const className = e.callee.name.lexeme;
        const classDecl = this.classes.get(className);
        if (!classDecl) throw new Error(`Class ${className} not found`);

        const structType = this.llvmHelper.getLLVMTypeByName(`struct.${className}`);
        const i64 = LLVM.Int64TypeInContext(ctx);
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        
        const size = LLVM.SizeOf(structType);
        const objPtrRaw = this.buildGCMalloc(size, "new_obj_raw");
        const objPtr = LLVM.BuildBitCast(this.builder, objPtrRaw, LLVM.PointerType(structType, 0), "new_obj");

        const initMethod = classDecl.methods.find(m => m.name.lexeme === 'init');
        if (initMethod) {
            const mangledName = `yu_class_${className}_init`;
            const f = LLVM.GetNamedFunction(this.module, mangledName);
            const ft = this.getClassMethodType(className, initMethod);
            const args = [objPtr, ...e.args.map((a, i) => {
                const arg = a.accept(this) as IRValue;
                const paramType = this.llvmHelper.getLLVMType(initMethod.parameters[i]?.type ?? null);
                return this.coerceToType(arg, paramType, "ctor_arg_cast");
            })];
            LLVM.BuildCall2(this.builder, ft, f, this.toPtrArr(args), args.length, "");
        }

        return { value: objPtr, type: LLVM.PointerType(structType, 0), pointeeType: structType };
    }
    visitDeleteExpr(e: DeleteExpr): IRValue { throw 0; }
    visitAddressOfExpr(e: AddressOfExpr): IRValue { throw 0; }
    visitDereferenceExpr(e: DereferenceExpr): IRValue { throw 0; }
    visitFunctionLiteralExpr(e: FunctionLiteralExpr): IRValue {
        const ctx = this.llvmHelper.getContext();
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        const functionTypeAnnotation = this.getFunctionTypeAnnotation(e.parameters, e.returnType);
        const closureType = this.llvmHelper.getLLVMType(functionTypeAnnotation);
        const functionType = this.llvmHelper.getClosureFunctionType(closureType);
        if (!functionType) throw new Error("Missing closure function type.");

        const captures = this.collectCaptures(e);
        const envFieldTypes = captures.map(c => LLVM.PointerType(c.symbol.llvmType, 0));
        const envType = LLVM.StructTypeInContext(ctx, this.toPtrArr(envFieldTypes), envFieldTypes.length, 0);
        const closureName = `yu_closure_${this.labelCounter++}`;
        const closureFn = LLVM.AddFunction(this.module, closureName, functionType);

        const outerBlock = LLVM.GetInsertBlock(this.builder);
        const envRaw = this.buildGCMalloc(LLVM.SizeOf(envType), "closure_env_raw");
        const envPtr = LLVM.BuildBitCast(this.builder, envRaw, LLVM.PointerType(envType, 0), "closure_env");
        captures.forEach((capture, index) => {
            const slot = LLVM.BuildStructGEP2(this.builder, envType, envPtr, index, "capture_slot");
            LLVM.BuildStore(this.builder, capture.symbol.ptr, slot);
        });

        const closurePtr = LLVM.BuildAlloca(this.builder, closureType, "closure");
        LLVM.BuildStore(this.builder, closureFn, LLVM.BuildStructGEP2(this.builder, closureType, closurePtr, 0, "closure_code_slot"));
        LLVM.BuildStore(this.builder, LLVM.BuildBitCast(this.builder, envPtr, i8Ptr, "closure_env_i8"), LLVM.BuildStructGEP2(this.builder, closureType, closurePtr, 1, "closure_env_slot"));
        const closureValue = LLVM.BuildLoad2(this.builder, closureType, closurePtr, "closure_value");

        LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(ctx, closureFn, "entry"));
        const prevScope = this.currentScope;
        const prevFunctionName = this.currentFunctionName;
        const prevReturnType = this.currentFunctionReturnType;
        const prevEnvType = this.currentClosureEnvType;
        const prevEnvPtr = this.currentClosureEnvPtr;
        const prevCaptures = this.currentClosureCaptures;

        this.currentScope = new Scope(this.globalScope, 1);
        this.currentFunctionName = closureName;
        this.currentFunctionReturnType = this.llvmHelper.getLLVMType(e.returnType);
        this.currentClosureEnvType = envType;
        this.currentClosureEnvPtr = LLVM.BuildBitCast(this.builder, LLVM.GetParam(closureFn, 0), LLVM.PointerType(envType, 0), "env");
        this.currentClosureCaptures = captures;

        captures.forEach((capture, index) => {
            const slot = LLVM.BuildStructGEP2(this.builder, envType, this.currentClosureEnvPtr, index, "capture_load_slot");
            const cellPtr = LLVM.BuildLoad2(this.builder, LLVM.PointerType(capture.symbol.llvmType, 0), slot, `${capture.name}_cell`);
            this.currentScope.define(capture.name, { ...capture.symbol, ptr: cellPtr, depth: 1 });
        });

        e.parameters.forEach((p, i) => {
            const pt = this.llvmHelper.getLLVMType(p.type);
            const cell = this.allocateCell(pt, p.name.lexeme);
            LLVM.BuildStore(this.builder, LLVM.GetParam(closureFn, i + 1), cell);
            this.currentScope.define(p.name.lexeme, { llvmType: pt, ptr: cell, depth: 1 });
        });

        e.body.statements.forEach(s => s.accept(this));
        if (LLVM.GetTypeKind(this.currentFunctionReturnType) === 0) LLVM.BuildRetVoid(this.builder);

        this.currentScope = prevScope;
        this.currentFunctionName = prevFunctionName;
        this.currentFunctionReturnType = prevReturnType;
        this.currentClosureEnvType = prevEnvType;
        this.currentClosureEnvPtr = prevEnvPtr;
        this.currentClosureCaptures = prevCaptures;
        LLVM.PositionBuilderAtEnd(this.builder, outerBlock);

        return {
            value: closureValue,
            type: closureType,
            address: closurePtr,
            extra: {
                closureFunctionType: functionType,
                closureParamTypes: functionTypeAnnotation.parameters.map(p => this.llvmHelper.getLLVMType(p)),
                closureReturnType: this.llvmHelper.getLLVMType(functionTypeAnnotation.returnType)
            }
        };
    }
    visitConstStmt(s: ConstStmt) {}
    visitIfStmt(s: IfStmt) {
        const ctx = this.llvmHelper.getContext();
        const condition = (s.condition.accept(this) as IRValue).value;
        const functionPtr = LLVM.GetBasicBlockParent(LLVM.GetInsertBlock(this.builder));

        const thenBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "then");
        const elseBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "else");
        const mergeBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "if_merge");

        LLVM.BuildCondBr(this.builder, condition, thenBB, elseBB);

        // Then block
        LLVM.PositionBuilderAtEnd(this.builder, thenBB);
        s.thenBranch.accept(this);
        if (!LLVM.GetBasicBlockTerminator(LLVM.GetInsertBlock(this.builder))) {
            LLVM.BuildBr(this.builder, mergeBB);
        }

        // Else block
        LLVM.PositionBuilderAtEnd(this.builder, elseBB);
        if (s.elseBranch) {
            s.elseBranch.accept(this);
        }
        if (!LLVM.GetBasicBlockTerminator(LLVM.GetInsertBlock(this.builder))) {
            LLVM.BuildBr(this.builder, mergeBB);
        }

        // Merge block
        LLVM.PositionBuilderAtEnd(this.builder, mergeBB);
    }
    visitWhileStmt(s: WhileStmt) {
        const ctx = this.llvmHelper.getContext();
        const functionPtr = LLVM.GetBasicBlockParent(LLVM.GetInsertBlock(this.builder));

        const condBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "while_cond");
        const bodyBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "while_body");
        const endBB = LLVM.AppendBasicBlockInContext(ctx, functionPtr, "while_end");

        LLVM.BuildBr(this.builder, condBB);

        // Condition block
        LLVM.PositionBuilderAtEnd(this.builder, condBB);
        const condition = (s.condition.accept(this) as IRValue).value;
        LLVM.BuildCondBr(this.builder, condition, bodyBB, endBB);

        // Body block
        LLVM.PositionBuilderAtEnd(this.builder, bodyBB);
        s.body.accept(this);
        if (!LLVM.GetBasicBlockTerminator(LLVM.GetInsertBlock(this.builder))) {
            LLVM.BuildBr(this.builder, condBB);
        }

        // End block
        LLVM.PositionBuilderAtEnd(this.builder, endBB);
    }
    visitClassDeclaration(d: ClassDeclaration) {
        const n = d.name.lexeme;
        this.classes.set(n, d);
        const ctx = this.llvmHelper.getContext();
        const structType = this.llvmHelper.getLLVMTypeByName(`struct.${n}`);

        if (this.pass === 'declaration') {
            const fieldTypes = d.properties.map(p => this.llvmHelper.getLLVMType(p.type));
            LLVM.StructSetBody(structType, this.toPtrArr(fieldTypes), fieldTypes.length, 0);

            d.methods.forEach(m => {
                const mn = m.name.lexeme;
                const mangledName = `yu_class_${n}_${mn}`;
                const ft = this.getClassMethodType(n, m);
                LLVM.AddFunction(this.module, mangledName, ft);
            });
        } else {
            d.methods.forEach(m => {
                const mn = m.name.lexeme;
                const mangledName = `yu_class_${n}_${mn}`;
                const f = LLVM.GetNamedFunction(this.module, mangledName);
                const ft = this.getClassMethodType(n, m);
                
                LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(ctx, f, "e"));
                const prevFunc = this.currentFunctionName, prevRet = this.currentFunctionReturnType;
                this.currentFunctionName = mangledName;
                this.currentFunctionReturnType = LLVM.GetReturnType(ft);
                
                const prevScope = this.currentScope;
                this.currentScope = new Scope(this.globalScope, 1);
                
                const thisPtr = LLVM.BuildAlloca(this.builder, LLVM.PointerType(structType, 0), "this");
                LLVM.BuildStore(this.builder, LLVM.GetParam(f, 0), thisPtr);
                this.currentScope.define("this", { llvmType: LLVM.PointerType(structType, 0), ptr: thisPtr, depth: 1, pointeeType: structType });

                m.parameters.forEach((p, i) => {
                    const pt = this.llvmHelper.getLLVMType(p.type), a = LLVM.BuildAlloca(this.builder, pt, p.name.lexeme);
                    LLVM.BuildStore(this.builder, LLVM.GetParam(f, i + 1), a);
                    this.currentScope.define(p.name.lexeme, { llvmType: pt, ptr: a, depth: 1 });
                });

                m.body.statements.forEach(s => s.accept(this));
                if (LLVM.GetTypeKind(this.currentFunctionReturnType) === 0) LLVM.BuildRetVoid(this.builder);
                
                this.currentScope = prevScope;
                this.currentFunctionName = prevFunc;
                this.currentFunctionReturnType = prevRet;
            });
        }
    }
    visitStructDeclaration(d: StructDeclaration) {}
    visitPropertyDeclaration(s: PropertyDeclaration) {}
    visitDeclareFunction(d: DeclareFunction) {}
    visitUsingStmt(s: UsingStmt) {}
    visitImportStmt(s: ImportStmt) {}
}
