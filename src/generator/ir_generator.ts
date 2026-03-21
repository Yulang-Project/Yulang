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
    extra?: { isMethod?: boolean; methodName?: string; }
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
    public indentLevel: number = 0;
    private labelCounter: number = 0;

    constructor(public platform: any, parser: Parser, mangle: boolean, path: string, debug: boolean) {
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
            const ft = LLVM.FunctionType(LLVM.Int32TypeInContext(ctx), this.toPtrArr([]), 0, 1);
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
            if (expr.name.lexeme === 'length') return { value: LLVM.BuildLoad2(this.builder, LLVM.Int64TypeInContext(ctx), LLVM.BuildStructGEP2(this.builder, actualType, ptr, 1, ""), "l"), type: LLVM.Int64TypeInContext(ctx) };
            if (expr.name.lexeme === 'push') return { value: obj.value, type: obj.type, address: obj.address, pointeeType: actualType, extra: { isMethod: true, methodName: 'push' } };
        }
        throw new Error(`Property ${expr.name.lexeme} not found`);
    }

    visitCallExpr(expr: CallExpr): IRValue {
        const ctx = this.llvmHelper.getContext(), callee = expr.callee.accept(this) as IRValue;
        const i64 = LLVM.Int64TypeInContext(ctx), i8p = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        if (callee.extra?.isMethod && callee.extra.methodName === 'push') {
            const arr = callee.address || callee.value, type = callee.pointeeType!, val = expr.args[0]!.accept(this) as IRValue;
            const lPtr = LLVM.BuildStructGEP2(this.builder, type, arr, 1, ""), cPtr = LLVM.BuildStructGEP2(this.builder, type, arr, 2, "");
            const l = LLVM.BuildLoad2(this.builder, i64, lPtr, ""), c = LLVM.BuildLoad2(this.builder, i64, cPtr, "");
            const isFull = LLVM.BuildICmp(this.builder, LLVMIntPredicate.LLVMIntEQ, l, c, "");
            const f = LLVM.GetBasicBlockParent(LLVM.GetInsertBlock(this.builder)), rBB = LLVM.AppendBasicBlockInContext(ctx, f, "r"), pBB = LLVM.AppendBasicBlockInContext(ctx, f, "p");
            LLVM.BuildCondBr(this.builder, isFull, rBB, pBB);
            LLVM.PositionBuilderAtEnd(this.builder, rBB);
            const nc = LLVM.BuildMul(this.builder, c, LLVM.ConstInt(i64, 2n as any, 0), ""), dfp = LLVM.BuildStructGEP2(this.builder, type, arr, 0, "");
            const od = LLVM.BuildLoad2(this.builder, i8p, dfp, ""), rft = LLVM.FunctionType(i8p, this.toPtrArr([i8p, i64]), 2, 0);
            let rf = LLVM.GetNamedFunction(this.module, "realloc"); if (!rf) rf = LLVM.AddFunction(this.module, "realloc", rft);
            const nd = LLVM.BuildCall2(this.builder, rft, rf, this.toPtrArr([od, LLVM.BuildMul(this.builder, nc, LLVM.ConstInt(i64, 8n as any, 0), "")]), 2, "");
            LLVM.BuildStore(this.builder, nd, dfp); LLVM.BuildStore(this.builder, nc, cPtr); LLVM.BuildBr(this.builder, pBB);
            LLVM.PositionBuilderAtEnd(this.builder, pBB);
            const dp = LLVM.BuildLoad2(this.builder, LLVM.PointerType(val.type, 0), LLVM.BuildStructGEP2(this.builder, type, arr, 0, ""), "");
            LLVM.BuildStore(this.builder, val.value, LLVM.BuildInBoundsGEP2(this.builder, val.type, dp, this.toPtrArr([l]), 1, ""));
            const nl = LLVM.BuildAdd(this.builder, l, LLVM.ConstInt(i64, 1n as any, 0), "");
            LLVM.BuildStore(this.builder, nl, lPtr); return { value: nl, type: i64 };
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
        const dp = LLVM.BuildLoad2(this.builder, LLVM.PointerType(LLVM.Int64TypeInContext(ctx), 0), LLVM.BuildStructGEP2(this.builder, at, a.address || a.value, 0, ""), "");
        const et = LLVM.Int64TypeInContext(ctx);
        const ep = LLVM.BuildInBoundsGEP2(this.builder, et, dp, this.toPtrArr([i.value]), 1, "");
        return { value: LLVM.BuildLoad2(this.builder, et, ep, ""), type: et, address: ep };
    }

    visitArrayLiteralExpr(e: ArrayLiteralExpr): IRValue {
        const ctx = this.llvmHelper.getContext(), els = e.elements.map(el => el.accept(this) as IRValue);
        const et = els[0]?.type || LLVM.Int64TypeInContext(ctx), st = this.llvmHelper.ensureArrayStructDefinition(et);
        const ap = LLVM.BuildAlloca(this.builder, st, "a"), i64 = LLVM.Int64TypeInContext(ctx), i8p = LLVM.PointerType(LLVM.Int8TypeInContext(ctx), 0);
        const cap = BigInt(Math.max(els.length, 4)), mft = LLVM.FunctionType(i8p, this.toPtrArr([i64]), 1, 0);
        let mf = LLVM.GetNamedFunction(this.module, "malloc"); if (!mf) mf = LLVM.AddFunction(this.module, "malloc", mft);
        const md = LLVM.BuildCall2(this.builder, mft, mf, this.toPtrArr([LLVM.ConstInt(i64, cap * 8n as any, 0)]), 1, "");
        const dp = LLVM.BuildBitCast(this.builder, md, LLVM.PointerType(et, 0), "");
        LLVM.BuildStore(this.builder, dp, LLVM.BuildStructGEP2(this.builder, st, ap, 0, ""));
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i64, BigInt(els.length) as any, 0), LLVM.BuildStructGEP2(this.builder, st, ap, 1, ""));
        LLVM.BuildStore(this.builder, LLVM.ConstInt(i64, cap as any, 0), LLVM.BuildStructGEP2(this.builder, st, ap, 2, ""));
        els.forEach((v, i) => LLVM.BuildStore(this.builder, v.value, LLVM.BuildInBoundsGEP2(this.builder, et, dp, this.toPtrArr([LLVM.ConstInt(i64, BigInt(i) as any, 0)]), 1, "")));
        return { value: LLVM.BuildLoad2(this.builder, st, ap, ""), type: st, address: ap, pointeeType: st };
    }

    visitFunctionDeclaration(d: FunctionDeclaration) {
        const n = d.name.lexeme, ctx = this.llvmHelper.getContext(), rt = this.llvmHelper.getLLVMType(d.returnType), pts = d.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
        const ft = LLVM.FunctionType(rt, this.toPtrArr(pts), pts.length, 0);
        if (this.pass === 'declaration') { this.globalScope.define(n, { llvmType: ft, ptr: LLVM.AddFunction(this.module, n, ft), depth: 0 }); }
        else {
            const f = LLVM.GetNamedFunction(this.module, n); LLVM.PositionBuilderAtEnd(this.builder, LLVM.AppendBasicBlockInContext(ctx, f, "e"));
            this.currentScope = new Scope(this.currentScope, 1);
            d.parameters.forEach((p, i) => {
                const pt = this.llvmHelper.getLLVMType(p.type), a = LLVM.BuildAlloca(this.builder, pt, p.name.lexeme);
                LLVM.BuildStore(this.builder, LLVM.GetParam(f, i), a); this.currentScope.define(p.name.lexeme, { llvmType: pt, ptr: a, depth: 1 });
            });
            d.body.statements.forEach(s => s.accept(this));
            if (LLVM.GetTypeKind(rt) === 0) LLVM.BuildRetVoid(this.builder);
            this.currentScope = this.globalScope;
        }
    }

    visitLetStmt(s: LetStmt) {
        const t = this.llvmHelper.getLLVMType(s.type), p = LLVM.BuildAlloca(this.builder, t, s.name.lexeme);
        this.currentScope.define(s.name.lexeme, { llvmType: t, ptr: p, depth: this.currentScope.depth });
        if (s.initializer) LLVM.BuildStore(this.builder, (s.initializer.accept(this) as IRValue).value, p);
    }

    visitReturnStmt(s: ReturnStmt) { 
        if (s.value) {
            const v = (s.value.accept(this) as IRValue);
            let val = v.value;
            // Force i32 for main return to satisfy LLC
            const i32 = LLVM.Int32TypeInContext(this.llvmHelper.getContext());
            val = LLVM.BuildTrunc(this.builder, v.value, i32, "");
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
    visitUnaryExpr(e: UnaryExpr): IRValue { throw 0; }
    visitGroupingExpr(e: GroupingExpr): IRValue { return e.expression.accept(this) as IRValue; }
    visitAssignExpr(e: AssignExpr): IRValue { throw 0; }
    visitThisExpr(e: ThisExpr): IRValue { throw 0; }
    visitObjectLiteralExpr(e: ObjectLiteralExpr): IRValue { throw 0; }
    visitNewExpr(e: NewExpr): IRValue { throw 0; }
    visitDeleteExpr(e: DeleteExpr): IRValue { throw 0; }
    visitAddressOfExpr(e: AddressOfExpr): IRValue { throw 0; }
    visitDereferenceExpr(e: DereferenceExpr): IRValue { throw 0; }
    visitFunctionLiteralExpr(e: FunctionLiteralExpr): IRValue { throw 0; }
    visitConstStmt(s: ConstStmt) {}
    visitIfStmt(s: IfStmt) {}
    visitWhileStmt(s: WhileStmt) {}
    visitClassDeclaration(d: ClassDeclaration) {}
    visitStructDeclaration(d: StructDeclaration) {}
    visitPropertyDeclaration(s: PropertyDeclaration) {}
    visitDeclareFunction(d: DeclareFunction) {}
    visitUsingStmt(s: UsingStmt) {}
    visitImportStmt(s: ImportStmt) {}
}
