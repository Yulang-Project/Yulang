// src/generator/ir_generator.ts
import {
    ASTNode, type ExprVisitor, type StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, IndexExpr, AssignExpr, ThisExpr, AsExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, AddressOfExpr, DereferenceExpr, FunctionLiteralExpr, ArrayLiteralExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction, UsingStmt,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation
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
    extra?: { isMethod?: boolean; methodName?: string; className?: string; }
};

type SymbolEntry = { llvmType: LLVMTypeRef; ptr: LLVMValueRef; depth: number; };

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
            return { value: entry.ptr, type: LLVM.PointerType(entry.llvmType, 0), pointeeType: entry.llvmType };
        }
        return {
            value: LLVM.BuildLoad2(this.builder, entry.llvmType, entry.ptr, name),
            type: entry.llvmType,
            address: entry.ptr
        };
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

        const mallocType = LLVM.FunctionType(i8Ptr, this.toPtrArr([i64]), 1, 0);
        let mallocFn = LLVM.GetNamedFunction(this.module, 'malloc');
        if (!mallocFn) mallocFn = LLVM.AddFunction(this.module, 'malloc', mallocType);

        const bufferSize = LLVM.ConstInt(i64, 64n as any, 0);
        const bufferPtr = LLVM.BuildCall2(this.builder, mallocType, mallocFn, this.toPtrArr([bufferSize]), 1, 'strbuf');

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

        const mallocType = LLVM.FunctionType(i8Ptr, this.toPtrArr([i64]), 1, 0);
        let mallocFn = LLVM.GetNamedFunction(this.module, 'malloc');
        if (!mallocFn) mallocFn = LLVM.AddFunction(this.module, 'malloc', mallocType);

        const pathPtr = this.toCStringPointer(pathArg);
        const readMode = this.getGlobalCStringPtr('rb');
        const filePtr = LLVM.BuildCall2(this.builder, fopenType, fopenFn, this.toPtrArr([pathPtr, readMode]), 2, 'file_read');

        LLVM.BuildCall2(this.builder, fseekType, fseekFn, this.toPtrArr([filePtr, LLVM.ConstInt(i64, 0n as any, 0), LLVM.ConstInt(i32, 2n as any, 0)]), 3, '');
        const fileLen = LLVM.BuildCall2(this.builder, ftellType, ftellFn, this.toPtrArr([filePtr]), 1, 'file_len');
        LLVM.BuildCall2(this.builder, fseekType, fseekFn, this.toPtrArr([filePtr, LLVM.ConstInt(i64, 0n as any, 0), LLVM.ConstInt(i32, 0n as any, 0)]), 3, '');

        const allocSize = LLVM.BuildAdd(this.builder, fileLen, LLVM.ConstInt(i64, 1n as any, 0), 'alloc_size');
        const buffer = LLVM.BuildCall2(this.builder, mallocType, mallocFn, this.toPtrArr([allocSize]), 1, 'file_buf');

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

    private emitLangItemStructs() {
        const ctx = this.llvmHelper.getContext();
        this.objectStructType = LLVM.StructCreateNamed(ctx, LangItems.object.structName);
        LLVM.StructSetBody(this.objectStructType, this.toPtrArr([]), 0, 0);
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
            if (p === 'declaration' && !LLVM.GetNamedFunction(this.module, "main")) {
                const i32 = LLVM.Int32TypeInContext(this.llvmHelper.getContext());
                const main = LLVM.AddFunction(this.module, "main", LLVM.FunctionType(i32, this.toPtrArr([]), 0, 0));
                LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(this.llvmHelper.getContext(), main, "entry"));
            }
        });
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
        const ptr = obj.address || obj.value;
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
        }

        if (callee.extra?.isMethod) {
            const objPtr = callee.address || callee.value;
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
                const od = LLVM.BuildLoad2(this.builder, i8p, dfp, ""), rft = LLVM.FunctionType(i8p, this.toPtrArr([i8p, i64]), 2, 0);
                let rf = LLVM.GetNamedFunction(this.module, "realloc"); if (!rf) rf = LLVM.AddFunction(this.module, "realloc", rft);
                const sizePerElement = LLVM.SizeOf(val.type);
                const nd = LLVM.BuildCall2(this.builder, rft, rf, this.toPtrArr([od, LLVM.BuildMul(this.builder, nc, sizePerElement, "")]), 2, "");
                LLVM.BuildStore(this.builder, nd, dfp); LLVM.BuildStore(this.builder, nc, cPtr); LLVM.BuildBr(this.builder, pBB);
                LLVM.PositionBuilderAtEnd(this.builder, pBB);
                const dp = LLVM.BuildLoad2(this.builder, LLVM.PointerType(val.type, 0), LLVM.BuildStructGEP2(this.builder, type, objPtr, 0, ""), "");
                LLVM.BuildStore(this.builder, val.value, LLVM.BuildInBoundsGEP2(this.builder, val.type, dp, this.toPtrArr([l]), 1, ""));
                const nl = LLVM.BuildAdd(this.builder, l, LLVM.ConstInt(i64, 1n as any, 0), "");
                LLVM.BuildStore(this.builder, nl, lPtr); return { value: nl, type: i64 };
            } else if (callee.extra.className) {
                const className = callee.extra.className;
                const mangledName = `yu_class_${className}_${methodName}`;
                const f = LLVM.GetNamedFunction(this.module, mangledName);
                const ft = LLVM.GetElementType(LLVM.TypeOf(f));
                const args = [objPtr, ...expr.args.map(a => (a.accept(this) as IRValue).value)];
                return { value: LLVM.BuildCall2(this.builder, ft, f, this.toPtrArr(args), args.length, ""), type: LLVM.GetReturnType(ft) };
            }
        }
        const ft = callee.pointeeType; if (!ft) throw new Error("Missing function type");
        const args = expr.args.map(a => {
            const v = a.accept(this) as IRValue;
            if (expr.callee instanceof GetExpr && expr.callee.object instanceof IdentifierExpr && expr.callee.object.name.lexeme === 'clib') {
                if (v.type === this.stringStructType || v.pointeeType === this.stringStructType) return LLVM.BuildLoad2(this.builder, i8p, LLVM.BuildStructGEP2(this.builder, this.stringStructType, v.address || v.value, 0, ""), "p");
            }
            return v.value;
        });
        return { value: LLVM.BuildCall2(this.builder, ft, callee.value, this.toPtrArr(args), args.length, ""), type: LLVM.GetReturnType(ft) };
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
        
        // Get the pointer type from the first field of the array struct
        const ptrType = LLVM.StructGetTypeAtIndex(at, 0); // This should be ElementType*
        const et = LLVM.GetElementType(ptrType); // This is ElementType
        
        const dp = LLVM.BuildLoad2(this.builder, ptrType, LLVM.BuildStructGEP2(this.builder, at, a.address || a.value, 0, ""), "data_ptr");
        const ep = LLVM.BuildInBoundsGEP2(this.builder, et, dp, this.toPtrArr([i.value]), 1, "element_ptr");
        return { value: LLVM.BuildLoad2(this.builder, et, ep, "element_val"), type: et, address: ep };
    }

    visitArrayLiteralExpr(e: ArrayLiteralExpr): IRValue {
        const ctx = this.llvmHelper.getContext(), els = e.elements.map(el => el.accept(this) as IRValue);
        const et = els[0]?.type || LLVM.Int64TypeInContext(ctx), st = this.llvmHelper.ensureArrayStructDefinition(et);
        const ap = LLVM.BuildAlloca(this.builder, st, "a"), i64 = LLVM.Int64TypeInContext(ctx), i8p = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        const cap = BigInt(Math.max(els.length, 4)), mft = LLVM.FunctionType(i8p, this.toPtrArr([i64]), 1, 0);
        let mf = LLVM.GetNamedFunction(this.module, "malloc"); if (!mf) mf = LLVM.AddFunction(this.module, "malloc", mft);
        
        const sizePerElement = LLVM.SizeOf(et);
        const totalSize = LLVM.BuildMul(this.builder, LLVM.ConstInt(i64, cap as any, 0), sizePerElement, "total_size");
        const md = LLVM.BuildCall2(this.builder, mft, mf, this.toPtrArr([totalSize]), 1, "");
        
        const dp = LLVM.BuildBitCast(this.builder, md, LLVM.PointerType(et, 0), "");
        LLVM.BuildStore(this.builder, dp, LLVM.BuildStructGEP2(this.builder, st, ap, 0, ""));
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i64, BigInt(els.length) as any, 0), LLVM.BuildStructGEP2(this.builder, st, ap, 1, ""));
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i64, cap as any, 0), LLVM.BuildStructGEP2(this.builder, st, ap, 2, ""));
        els.forEach((v, i) => LLVM.BuildStore(this.builder, v.value, LLVM.BuildInBoundsGEP2(this.builder, et, dp, this.toPtrArr([LLVM.ConstInt(i64, BigInt(i) as any, 0)]), 1, "")));
        return { value: LLVM.BuildLoad2(this.builder, st, ap, ""), type: st, address: ap, pointeeType: st };
    }

    visitFunctionDeclaration(d: FunctionDeclaration) {
        let n = d.name.lexeme;
        if (this.mangle && n !== 'main') {
            n = `yu_${n}`;
        }
        const ctx = this.llvmHelper.getContext(), rt = this.llvmHelper.getLLVMType(d.returnType), pts = d.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
        const ft = LLVM.FunctionType(rt, this.toPtrArr(pts), pts.length, 0);
        if (this.pass === 'declaration') { this.globalScope.define(d.name.lexeme, { llvmType: ft, ptr: LLVM.AddFunction(this.module, n, ft), depth: 0 }); }
        else {
            const f = LLVM.GetNamedFunction(this.module, n); 
            if (!f) throw new Error(`Function ${n} not found during definition pass`);
            LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(ctx, f, "e"));
            const previousFunctionName = this.currentFunctionName;
            const previousFunctionReturnType = this.currentFunctionReturnType;
            this.currentFunctionName = d.name.lexeme;
            this.currentFunctionReturnType = rt;
            this.currentScope = new Scope(this.currentScope, 1);
            d.parameters.forEach((p, i) => {
                const pt = this.llvmHelper.getLLVMType(p.type), a = LLVM.BuildAlloca(this.builder, pt, p.name.lexeme);
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
        const t = this.llvmHelper.getLLVMType(s.type), p = LLVM.BuildAlloca(this.builder, t, s.name.lexeme);
        this.currentScope.define(s.name.lexeme, { llvmType: t, ptr: p, depth: this.currentScope.depth });
        if (s.initializer) LLVM.BuildStore(this.builder, (s.initializer.accept(this) as IRValue).value, p);
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
                    val = LLVM.BuildBitCast(this.builder, v.value, targetType, "ret_cast");
                }
            } else if (this.currentFunctionName === 'main' && this.isIntegerLikeType(v.type) && v.type !== i32) {
                val = LLVM.BuildTrunc(this.builder, v.value, i32, "main_ret_i32");
            }

            LLVM.BuildRet(this.builder, val); 
        } else {
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
    visitAssignExpr(e: AssignExpr): IRValue {
        const target = e.target.accept(this) as IRValue;
        const value = e.value.accept(this) as IRValue;
        if (!target.address) throw new Error("Assignment target must have an address");
        LLVM.BuildStore(this.builder, value.value, target.address);
        return value;
    }
    visitThisExpr(e: ThisExpr): IRValue {
        return this.resolveSymbolValue("this");
    }
    visitObjectLiteralExpr(e: ObjectLiteralExpr): IRValue { throw 0; }
    visitNewExpr(e: NewExpr): IRValue {
        const ctx = this.llvmHelper.getContext();
        if (!(e.callee instanceof IdentifierExpr)) throw new Error("New expression must call a class name");
        const className = e.callee.name.lexeme;
        const classDecl = this.classes.get(className);
        if (!classDecl) throw new Error(`Class ${className} not found`);

        const structType = this.llvmHelper.getLLVMTypeByName(`struct.${className}`);
        const i64 = LLVM.Int64TypeInContext(ctx);
        const i8Ptr = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        
        const mallocType = LLVM.FunctionType(i8Ptr, this.toPtrArr([i64]), 1, 0);
        let mallocFn = LLVM.GetNamedFunction(this.module, 'malloc');
        if (!mallocFn) mallocFn = LLVM.AddFunction(this.module, 'malloc', mallocType);
        
        const size = LLVM.SizeOf(structType);
        const objPtrRaw = LLVM.BuildCall2(this.builder, mallocType, mallocFn, this.toPtrArr([size]), 1, "new_obj_raw");
        const objPtr = LLVM.BuildBitCast(this.builder, objPtrRaw, LLVM.PointerType(structType, 0), "new_obj");

        const initMethod = classDecl.methods.find(m => m.name.lexeme === 'init');
        if (initMethod) {
            const mangledName = `yu_class_${className}_init`;
            const f = LLVM.GetNamedFunction(this.module, mangledName);
            const ft = LLVM.GetElementType(LLVM.TypeOf(f));
            const args = [objPtr, ...e.args.map(a => (a.accept(this) as IRValue).value)];
            LLVM.BuildCall2(this.builder, ft, f, this.toPtrArr(args), args.length, "");
        }

        return { value: objPtr, type: LLVM.PointerType(structType, 0), pointeeType: structType };
    }
    visitDeleteExpr(e: DeleteExpr): IRValue { throw 0; }
    visitAddressOfExpr(e: AddressOfExpr): IRValue { throw 0; }
    visitDereferenceExpr(e: DereferenceExpr): IRValue { throw 0; }
    visitFunctionLiteralExpr(e: FunctionLiteralExpr): IRValue { throw 0; }
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
            d.methods.forEach(m => {
                const mn = m.name.lexeme;
                const mangledName = `yu_class_${n}_${mn}`;
                const rt = this.llvmHelper.getLLVMType(m.returnType);
                const pts = [LLVM.PointerType(structType, 0), ...m.parameters.map(p => this.llvmHelper.getLLVMType(p.type))];
                const ft = LLVM.FunctionType(rt, this.toPtrArr(pts), pts.length, 0);
                LLVM.AddFunction(this.module, mangledName, ft);
            });
        } else {
            const fieldTypes = d.properties.map(p => this.llvmHelper.getLLVMType(p.type));
            LLVM.StructSetBody(structType, this.toPtrArr(fieldTypes), fieldTypes.length, 0);

            d.methods.forEach(m => {
                const mn = m.name.lexeme;
                const mangledName = `yu_class_${n}_${mn}`;
                const f = LLVM.GetNamedFunction(this.module, mangledName);
                const ft = LLVM.GetElementType(LLVM.TypeOf(f));
                
                LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(ctx, f, "e"));
                const prevFunc = this.currentFunctionName, prevRet = this.currentFunctionReturnType;
                this.currentFunctionName = mangledName;
                this.currentFunctionReturnType = LLVM.GetReturnType(ft);
                
                const prevScope = this.currentScope;
                this.currentScope = new Scope(this.globalScope, 1);
                
                const thisPtr = LLVM.BuildAlloca(this.builder, LLVM.PointerType(structType, 0), "this");
                LLVM.BuildStore(this.builder, LLVM.GetParam(f, 0), thisPtr);
                this.currentScope.define("this", { llvmType: LLVM.PointerType(structType, 0), ptr: thisPtr, depth: 1 });

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
