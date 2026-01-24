// src/generator/ir_generator.ts

import {
    ASTNode, type ExprVisitor, type StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, AssignExpr, ThisExpr, AsExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, AddressOfExpr, DereferenceExpr, FunctionLiteralExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, UsingStmt, PointerTypeAnnotation, FunctionTypeAnnotation
} from '../ast.js';
import { Token, TokenType } from '../token.js';
import { LLVMIRHelper } from './llvm_ir_helpers.js';
import { Parser } from '../parser/index.js'; // Added Parser import
import * as path from 'path'; // Added path import
import * as process from 'process'; // Added process import
import { BuiltinFunctions } from './builtins.js';
import { LangItems } from './lang_items.js';
import { findPredefinedFunction } from '../predefine/funs.js';

export type IRValue = { value: string, type: string, classInstancePtr?: string, classInstancePtrType?: string, ptr?: string, ptrType?: string, address?: string };

type SymbolEntry = {
    llvmType: string; // 变量的 LLVM 类型 (例如, i32, i8*, %struct.MyClass*)
    ptr: string;      // LLVM IR 中指向变量值存储位置的指针名称 (例如, %var_ptr)
    isPointer: boolean; // 如果这个 Yulang 变量本身是一个指针类型 (例如, `let p: pointer(char)`)，则为 true
    definedInScopeDepth: number; // 变量定义的深度，用于闭包捕获分析
};

// Represents a single scope (e.g., a function body, an if-block)
class Scope {
    private symbols: Map<string, SymbolEntry> = new Map();
    constructor(public parent: Scope | null = null, public depth: number = 0) {}

    define(name: string, entry: SymbolEntry): boolean {
        if (this.symbols.has(name)) {
            return false; // Variable already defined in this scope
        }
        this.symbols.set(name, entry);
        return true;
    }

    find(name: string): SymbolEntry | null {
        return this.symbols.get(name) || this.parent?.find(name) || null;
    }
}

class CapturedVariableInfo {
    constructor(
        public name: string,
        public llvmType: string, // 变量本身的类型 (例如, i32, %struct.MyStruct, i32*)
        public ptr: string,      // 指向该变量存储位置的 alloca/global ptr
        public definedInScopeDepth: number
    ) {}
}

// 辅助访问者，用于在函数体中查找捕获的变量
class ClosureAnalyzer implements ExprVisitor<void>, StmtVisitor<void> {
    private captured: Map<string, CapturedVariableInfo> = new Map();
    private outerScopeAtLiteralDefinition: Scope; // 闭包字面量定义时的外部作用域
    private functionBodyScopeDepth: number; // 闭包函数体将创建的作用域的深度

    constructor(outerScopeAtLiteralDefinition: Scope, functionBodyScopeDepth: number) {
        this.outerScopeAtLiteralDefinition = outerScopeAtLiteralDefinition;
        this.functionBodyScopeDepth = functionBodyScopeDepth;
    }

    getCapturedVariables(): CapturedVariableInfo[] {
        return Array.from(this.captured.values());
    }

    private resolveIdentifierAndCaptureIfNecessary(name: string) {
        // 从闭包字面量定义时的外部作用域开始向上查找
        let currentSearchScope: Scope | null = this.outerScopeAtLiteralDefinition;
        while (currentSearchScope) {
            const entry = currentSearchScope.find(name); // 使用公共的 find 方法
            if (entry) {
                // 找到了一个符号。判断它是否需要被捕获。
                // 如果它在外部作用域定义 (definedInScopeDepth < 闭包函数体作用域深度)
                // 并且它不是全局变量 (definedInScopeDepth > 0)
                if (entry.definedInScopeDepth < this.functionBodyScopeDepth &&
                    entry.definedInScopeDepth > 0) { 
                    
                    if (!this.captured.has(name)) {
                        this.captured.set(name, new CapturedVariableInfo(
                            name,
                            entry.llvmType,
                            entry.ptr,
                            entry.definedInScopeDepth
                        ));
                    }
                }
                return; // 找到了（无论是局部、全局还是捕获的），停止搜索
            }
            currentSearchScope = currentSearchScope.parent;
        }
        // 如果在任何作用域中都未找到，则它是一个未声明的标识符。
        // 此访问者仅识别 *捕获的* 变量，不处理一般的语义错误。
        // 语义分析阶段会处理未声明的变量。
    }

    // --- ExprVisitor ---
    visitLiteralExpr(expr: LiteralExpr): void {}
    visitBinaryExpr(expr: BinaryExpr): void { expr.left.accept(this); expr.right.accept(this); }
    visitUnaryExpr(expr: UnaryExpr): void { expr.right.accept(this); }
    visitAddressOfExpr(expr: AddressOfExpr): void { expr.expression.accept(this); }
    visitDereferenceExpr(expr: DereferenceExpr): void { expr.expression.accept(this); }
    visitGroupingExpr(expr: GroupingExpr): void { expr.expression.accept(this); }
    visitCallExpr(expr: CallExpr): void { expr.callee.accept(this); expr.args.forEach(arg => arg.accept(this)); }
    visitGetExpr(expr: GetExpr): void { expr.object.accept(this); }
    visitAssignExpr(expr: AssignExpr): void { expr.target.accept(this); expr.value.accept(this); }
    visitThisExpr(expr: ThisExpr): void { /* 'this' 通常作为隐式参数处理，不作为捕获变量 */ }
    visitAsExpr(expr: AsExpr): void { expr.expression.accept(this); }
    visitObjectLiteralExpr(expr: ObjectLiteralExpr): void { expr.properties.forEach(v => v.accept(this)); }
    visitNewExpr(expr: NewExpr): void { expr.callee.accept(this); expr.args.forEach(arg => arg.accept(this)); }
    visitDeleteExpr(expr: DeleteExpr): void { expr.target.accept(this); }
    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): void { /* 嵌套的函数字面量主体由其自身的 ClosureAnalyzer 处理，此处不深入 */ }

    visitIdentifierExpr(expr: IdentifierExpr): void {
        this.resolveIdentifierAndCaptureIfNecessary(expr.name.lexeme);
    }

    // --- StmtVisitor ---
    visitExpressionStmt(stmt: ExpressionStmt): void { stmt.expression.accept(this); }
    visitBlockStmt(stmt: BlockStmt): void { stmt.statements.forEach(s => s.accept(this)); }
    visitLetStmt(stmt: LetStmt): void { // 变量声明的初始化器可能引用外部变量
        if (stmt.initializer) stmt.initializer.accept(this);
        // 此处的 LetStmt 定义了局部变量，这些局部变量不会被外部捕获，
        // 但它们的值可能依赖于外部变量，因此需要解析初始化器。
    }
    visitConstStmt(stmt: ConstStmt): void { // 同 LetStmt
        if (stmt.initializer) stmt.initializer.accept(this);
    }
    visitIfStmt(stmt: IfStmt): void {
        stmt.condition.accept(this);
        stmt.thenBranch.accept(this);
        if (stmt.elseBranch) stmt.elseBranch.accept(this);
    }
    visitWhileStmt(stmt: WhileStmt): void { stmt.condition.accept(this); stmt.body.accept(this); }
    visitReturnStmt(stmt: ReturnStmt): void { if (stmt.value) stmt.value.accept(this); }
    // 其他语句通过其表达式或不包含可捕获的标识符
    visitFunctionDeclaration(decl: FunctionDeclaration): void {} // 此分析器用于字面量，而非声明
    visitClassDeclaration(decl: ClassDeclaration): void {}
    visitStructDeclaration(decl: StructDeclaration): void {}
    visitPropertyDeclaration(stmt: PropertyDeclaration): void { if (stmt.initializer) stmt.initializer.accept(this); }
    visitImportStmt(stmt: ImportStmt): void {}
    visitDeclareFunction(decl: DeclareFunction): void {}
    visitUsingStmt(stmt: UsingStmt): void {}
}


type MemberEntry = {
    llvmType: string;
    index: number;
};

type ClassEntry = {
    llvmType: string; // e.g., %struct.MyClass
    members: Map<string, MemberEntry>;
    methods: Map<string, FunctionDeclaration>; // NEW: Store method declarations
};

type ModuleMember = {
    llvmType: string;
    index: number;
    ptr: string;
};

export class IRGenerator implements ExprVisitor<IRValue>, StmtVisitor<void> {
    public builder: string[] = [];
    public indentLevel: number = 0;
    public llvmHelper: LLVMIRHelper = new LLVMIRHelper();
    public builtins: BuiltinFunctions;

    private globalScope: Scope = new Scope(null, 0);
    public currentScope: Scope = this.globalScope;
    private currentFunction: FunctionDeclaration | null = null;
    private labelCounter = 0;
    private classDefinitions: Map<string, ClassEntry> = new Map();
    private declaredSymbols: Set<string> = new Set(); // NEW: Track declared symbols
    private generatedFunctions: Set<string> = new Set(); // Track emitted function definitions
    private sretPointer: string | null = null; // 用于存储结构体返回的隐式 SRET 指针
    // private ctors: string[] = []; // No longer needed for global_ctors
    private parser: Parser;
    private mangleStdLib: boolean;
    private sourceFilePath: string; // New field
    private debug: boolean; // NEW: Debug flag
    private pass: 'declaration' | 'definition' = 'declaration'; // NEW: Compiler pass flag
    private objectLiteralCounter: number = 0;
    private heapGlobalsEmitted: boolean = false;
    private lowLevelRuntimeEmitted: boolean = false;
    private moduleObjects: Map<string, { structName: string, globalName: string, members: Map<string, ModuleMember>, initialized: boolean }> = new Map();
    private hoistedDefinitions: string[] = []; // Type/const definitions emitted inside functions that must live at module scope
    private hoistedFunctions: string[][] = []; // Full function definitions emitted while inside another function

    // Splits a LLVM struct type string "{ T1, T2, ... }" into its top-level fields safely (ignoring nested commas).
    private splitStructFields(structType: string): string[] {
        const trimmed = structType.trim();
        const withoutBraces = (trimmed.startsWith('{') && trimmed.endsWith('}'))
            ? trimmed.slice(1, -1)
            : trimmed;
        const fields: string[] = [];
        let current = '';
        let depth = 0;
        for (const ch of withoutBraces) {
            if (ch === ',' && depth === 0) {
                if (current.trim().length > 0) fields.push(current.trim());
                current = '';
                continue;
            }
            if (ch === '(' || ch === '{' || ch === '[') depth++;
            if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
            current += ch;
        }
        if (current.trim().length > 0) fields.push(current.trim());
        return fields;
    }

    private emitHoisted(def: string) {
        if (!this.hoistedDefinitions.includes(def)) {
            this.hoistedDefinitions.push(def);
        }
    }

    private hoistFunctionDefinition(lines: string[]) {
        if (lines.length > 0) this.hoistedFunctions.push(lines);
    }

    constructor(parser: Parser, mangleStdLib: boolean = true, sourceFilePath: string = '', debug: boolean = false) { // Accept sourceFilePath parameter
        this.parser = parser;
        this.mangleStdLib = mangleStdLib;
        this.sourceFilePath = sourceFilePath; // Initialize new field
        this.debug = debug; // Initialize new debug flag
        this.builtins = new BuiltinFunctions(this.llvmHelper);
        this.llvmHelper.setGenerator(this); // Set back-reference for helpers
        this.emit(`target triple = "${this.llvmHelper.getTargetTriple()}"`, false);
        this.emit(`target datalayout = "${this.llvmHelper.getDataLayout()}"`, false);
        this.emitLangItemStructs();
        this.emitHeapGlobals();
        this.emitLowLevelRuntime();
        this.emit("", false);
        // dlopen and dlsym are no longer declared here for stdlib
    }

    public getGlobalSymbol(name: string): SymbolEntry | null { // NEW
        return this.globalScope.find(name);
    }

    public generate(nodes: ASTNode[]): string {
        this.emitGlobalDefinitions(nodes);

        if (this.debug) console.log("Starting IR generation, global scope depth:", this.globalScope.depth);

        nodes.forEach(node => {
            if (node instanceof FunctionDeclaration) {
                if (this.debug) console.log("Processing top-level FunctionDeclaration:", node.name.lexeme);
                (node as Stmt).accept(this);
            } else if (node instanceof LetStmt || node instanceof ConstStmt || node instanceof ImportStmt || node instanceof DeclareFunction) {
                (node as Stmt).accept(this);
            }
        });

        // Insert hoisted definitions (e.g., closure env structs or nested functions) before the first function definition
        if (this.hoistedDefinitions.length > 0 || this.hoistedFunctions.length > 0) {
            const insertionIndex = this.builder.findIndex(line => line.trim().startsWith('define '));
            const insertAt = insertionIndex >= 0 ? insertionIndex : this.builder.length;
            const hoistedFunctionsFlat = this.hoistedFunctions.flat();
            const hoisted = [...this.hoistedDefinitions, ...hoistedFunctionsFlat];
            this.builder = [
                ...this.builder.slice(0, insertAt),
                ...hoisted,
                ...this.builder.slice(insertAt),
            ];
        }

        // Add all accumulated global string definitions at the end
        this.llvmHelper.getGlobalStrings().forEach(def => {
            if (!this.builder.includes(def)) {
                this.builder.push(def);
            }
        });

        // Add global constructors if any - No longer needed, as we're statically linking stdlib
        // if (this.ctors.length > 0) {
        //     const ctorEntries = this.ctors.map(ctor => `{ i32 65535, void ()* ${ctor}, i8* null }`).join(', ');
        //     this.emit(`@llvm.global_ctors = appending global [${this.ctors.length} x { i32, void ()*, i8* }] [${ctorEntries}]`, false);
        // }

        return this.builder.join('\n');
    }

    private emitGlobalDefinitions(nodes: ASTNode[]): void {
        const functions: FunctionDeclaration[] = [];

        // 先处理导入和类型定义，确保模块和类型可见；收集函数
        nodes.forEach(node => {
            if (node instanceof ImportStmt) {
                this.visitImportStmt(node);
            } else if (node instanceof ClassDeclaration || node instanceof StructDeclaration) {
                (node as Stmt).accept(this);
            } else if (node instanceof FunctionDeclaration) {
                functions.push(node);
            } else if (node instanceof DeclareFunction) {
                this.visitDeclareFunction(node); // declare 函数直接发出声明
            }
        });

        // 第二遍：先声明所有函数符号（防止调用时未定义）
        functions.forEach(fn => {
            const key = this.getFunctionKey(fn);
            if (!this.declaredSymbols.has(key)) {
                this.declareFunctionSymbol(fn);
                this.declaredSymbols.add(key);
            }
        });

        // 第三遍：发出函数定义
        functions.forEach(fn => {
            const key = this.getFunctionKey(fn);
            if (!this.generatedFunctions.has(key)) {
                this.emitFunctionDefinition(fn);
                this.generatedFunctions.add(key);
            }
        });
        this.builder.push("");
    }

    private enterScope(): void {
        this.currentScope = new Scope(this.currentScope, this.currentScope.depth + 1);
    }

    private exitScope(): void {
        if (this.currentScope.parent) {
            this.currentScope = this.currentScope.parent;
        }
    }
    
    public getNewLabel(prefix: string): string {
        return `${prefix}.${this.labelCounter++}`;
    }

    public emit(ir: string, indent: boolean = true): void {
        if (ir === null || ir === undefined) return;
        const indentation = indent ? '  '.repeat(this.indentLevel) : '';
        this.builder.push(`${indentation}${ir}`);
    }

    public ensureSyscallDecl(): void {
        // legacy no-op; syscall impl emitted in emitLowLevelRuntime
    }

    public ensureHeapGlobals(): void {
        // No-op; globals emitted once in emitHeapGlobals
    }

    private emitHeapGlobals(): void {
        if (this.heapGlobalsEmitted) return;
        this.heapGlobalsEmitted = true;
        this.emit(`@__heap_base = internal global i8* null, align 8`, false);
        this.emit(`@__heap_brk = internal global i8* null, align 8`, false);
        this.emit(`@__heap_initialized = internal global i1 false, align 1`, false);
        this.emit(`@__free_list = internal global %struct.free_node* null, align 8`, false);
    }

    private emitLowLevelRuntime(): void {
        if (this.lowLevelRuntimeEmitted) return;
        this.lowLevelRuntimeEmitted = true;
        // free list struct (unused for now but kept for ABI)
        this.emit(`%struct.free_node = type { i64, i8* }`, false);
        // syscall wrapper: __syscall6(n, a1..a6)
        this.emit(`define internal i64 @__syscall6(i64 %n, i64 %a1, i64 %a2, i64 %a3, i64 %a4, i64 %a5, i64 %a6) {`, false);
        this.indentLevel++;
        const res = this.llvmHelper.getNewTempVar();
        this.emit(`${res} = call i64 asm sideeffect "syscall", "={rax},0,{rdi},{rsi},{rdx},{r10},{r8},{r9},~{rcx},~{r11},~{memory}"(i64 %n, i64 %a1, i64 %a2, i64 %a3, i64 %a4, i64 %a5, i64 %a6)`, true);
        this.emit(`ret i64 ${res}`);
        this.indentLevel--;
        this.emit(`}`, false);
        this.emit(``, false);

        // memcpy inline implementation (byte loop)
        this.emit(`define internal void @__memcpy_inline(i8* %dst, i8* %src, i64 %len) {`, false);
        this.indentLevel++;
        const cmp = this.getNewLabel('memcpy.cmp');
        const body = this.getNewLabel('memcpy.body');
        const exit = this.getNewLabel('memcpy.exit');
        const idx = this.llvmHelper.getNewTempVar();
        this.emit(`${idx} = alloca i64, align 8`);
        this.emit(`store i64 0, i64* ${idx}, align 8`);
        this.emit(`br label %${cmp}`);

        this.emit(`${cmp}:`, false);
        const cur = this.llvmHelper.getNewTempVar();
        this.emit(`${cur} = load i64, i64* ${idx}, align 8`);
        const cond = this.llvmHelper.getNewTempVar();
        this.emit(`${cond} = icmp ult i64 ${cur}, %len`);
        this.emit(`br i1 ${cond}, label %${body}, label %${exit}`);

        this.emit(`${body}:`, false);
        const dstPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${dstPtr} = getelementptr inbounds i8, i8* %dst, i64 ${cur}`);
        const srcPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${srcPtr} = getelementptr inbounds i8, i8* %src, i64 ${cur}`);
        const byteVal = this.llvmHelper.getNewTempVar();
        this.emit(`${byteVal} = load i8, i8* ${srcPtr}, align 1`);
        this.emit(`store i8 ${byteVal}, i8* ${dstPtr}, align 1`);
        const next = this.llvmHelper.getNewTempVar();
        this.emit(`${next} = add i64 ${cur}, 1`);
        this.emit(`store i64 ${next}, i64* ${idx}, align 8`);
        this.emit(`br label %${cmp}`);

        this.emit(`${exit}:`, false);
        this.emit(`ret void`);
        this.indentLevel--;
        this.emit(`}`, false);
        this.emit(``, false);

        // heap init
        this.emit(`define internal void @__heap_init() {`, false);
        this.indentLevel++;
        const initFlagHeap = this.llvmHelper.getNewTempVar();
        this.emit(`${initFlagHeap} = load i1, i1* @__heap_initialized, align 1`);
        const doneLbl = this.getNewLabel('heap.init.done');
        const doLbl = this.getNewLabel('heap.init.do');
        this.emit(`br i1 ${initFlagHeap}, label %${doneLbl}, label %${doLbl}`);
        this.emit(`${doLbl}:`, false);
        this.indentLevel++;
        const curBrkInit = this.llvmHelper.getNewTempVar();
        this.emit(`${curBrkInit} = call i64 @__syscall6(i64 12, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        const curp = this.llvmHelper.getNewTempVar();
        this.emit(`${curp} = inttoptr i64 ${curBrkInit} to i8*`);
        this.emit(`store i8* ${curp}, i8** @__heap_base, align 8`);
        this.emit(`store i8* ${curp}, i8** @__heap_brk, align 8`);
        this.emit(`store i1 true, i1* @__heap_initialized, align 1`);
        this.emit(`br label %${doneLbl}`);
        this.indentLevel--;
        this.emit(`${doneLbl}:`, false);
        this.emit(`ret void`);
        this.indentLevel--;
        this.emit(`}`, false);
        this.emit(``, false);

        // malloc (simple bump)
        this.emit(`define internal i8* @yulang_malloc(i64 %size) {`, false);
        this.indentLevel++;
        this.emit(`call void @__heap_init()`);
        const aligned = this.llvmHelper.getNewTempVar();
        this.emit(`${aligned} = add i64 %size, 7`);
        const aligned2 = this.llvmHelper.getNewTempVar();
        this.emit(`${aligned2} = and i64 ${aligned}, -8`);
        const curbrkMalloc = this.llvmHelper.getNewTempVar();
        this.emit(`${curbrkMalloc} = load i8*, i8** @__heap_brk, align 8`);
        const nextbrk = this.llvmHelper.getNewTempVar();
        this.emit(`${nextbrk} = getelementptr inbounds i8, i8* ${curbrkMalloc}, i64 ${aligned2}`);
        const nextint = this.llvmHelper.getNewTempVar();
        this.emit(`${nextint} = ptrtoint i8* ${nextbrk} to i64`);
        const brkres = this.llvmHelper.getNewTempVar();
        this.emit(`${brkres} = call i64 @__syscall6(i64 12, i64 ${nextint}, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        const brkptr = this.llvmHelper.getNewTempVar();
        this.emit(`${brkptr} = inttoptr i64 ${brkres} to i8*`);
        this.emit(`store i8* ${brkptr}, i8** @__heap_brk, align 8`);
        this.emit(`ret i8* ${curbrkMalloc}`);
        this.indentLevel--;
        this.emit(`}`, false);
        this.emit(``, false);

        // free (only top-of-heap reclaim)
        this.emit(`define internal void @yulang_free(i8* %ptr, i64 %size) {`, false);
        this.indentLevel++;
        const alignedF = this.llvmHelper.getNewTempVar();
        this.emit(`${alignedF} = add i64 %size, 7`);
        const aligned2F = this.llvmHelper.getNewTempVar();
        this.emit(`${aligned2F} = and i64 ${alignedF}, -8`);
        const curbrkF = this.llvmHelper.getNewTempVar();
        this.emit(`${curbrkF} = load i8*, i8** @__heap_brk, align 8`);
        const nextptrF = this.llvmHelper.getNewTempVar();
        this.emit(`${nextptrF} = getelementptr inbounds i8, i8* %ptr, i64 ${aligned2F}`);
        const istop = this.llvmHelper.getNewTempVar();
        this.emit(`${istop} = icmp eq i8* ${nextptrF}, ${curbrkF}`);
        const retEnd = this.getNewLabel('free.end');
        const retTop = this.getNewLabel('free.top');
        this.emit(`br i1 ${istop}, label %${retTop}, label %${retEnd}`);
        this.emit(`${retTop}:`, false);
        const ptrint = this.llvmHelper.getNewTempVar();
        this.emit(`${ptrint} = ptrtoint i8* %ptr to i64`);
        this.emit(`call i64 @__syscall6(i64 12, i64 ${ptrint}, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        this.emit(`store i8* %ptr, i8** @__heap_brk, align 8`);
        this.emit(`br label %${retEnd}`);
        this.emit(`${retEnd}:`, false);
        this.emit(`ret void`);
        this.indentLevel--;
        this.emit(`}`, false);
        this.emit(``, false);
    }

    private ensureI64(irValue: IRValue): string {
        if (irValue.type === 'i64') return irValue.value;

        const tempVar = this.llvmHelper.getNewTempVar();
        if (irValue.type === 'i32') {
            this.emit(`${tempVar} = sext i32 ${irValue.value} to i64`);
            return tempVar;
        }
        if (irValue.type === 'i1') {
            this.emit(`${tempVar} = zext i1 ${irValue.value} to i64`);
            return tempVar;
        }
        if (irValue.type.endsWith('*')) {
            this.emit(`${tempVar} = ptrtoint ${irValue.type} ${irValue.value} to i64`);
            return tempVar;
        }

        throw new Error(`Cannot convert type ${irValue.type} to i64 for syscall.`);
    }

    private getFunctionKey(decl: FunctionDeclaration): string {
        return `${this.sourceFilePath}:${decl.name.lexeme}`;
    }

    private emitLangItemStructs(): void {
        // string struct
        if (!this.classDefinitions.has(LangItems.string.className)) {
            this.emit(`${LangItems.string.structName} = type { i8*, i64 }`, false);
            const members = new Map<string, MemberEntry>([
                [LangItems.string.members.ptr ? 'ptr' : 'ptr', { llvmType: 'i8*', index: LangItems.string.members.ptr.index }],
                [LangItems.string.members.len ? 'len' : 'len', { llvmType: 'i64', index: LangItems.string.members.len.index }],
            ]);
            this.classDefinitions.set(LangItems.string.className, {
                llvmType: LangItems.string.structName,
                members,
                methods: new Map()
            });
        }

        // object base struct (empty, used for built-in object)
        if (!this.classDefinitions.has(LangItems.object.typeName)) {
            this.emit(`${LangItems.object.structName} = type {}`, false);
            this.classDefinitions.set(LangItems.object.typeName, {
                llvmType: LangItems.object.structName,
                members: new Map(),
                methods: new Map()
            });
        }
    }

    private buildModuleObject(fullModulePath: string): void {
        if (this.moduleObjects.has(fullModulePath)) return;
        const moduleStatements = this.parser.moduleDeclarations.get(fullModulePath);
        if (!moduleStatements) {
            throw new Error(`Module statements not found for path: ${fullModulePath}`);
        }

        const relativeModulePath = path.relative(process.cwd(), fullModulePath);
        const moduleNamePart = relativeModulePath.replace(/\.yu$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        const structName = `%struct.module_${moduleNamePart}`;
        const globalName = `@module_${moduleNamePart}`;
        const members: Map<string, ModuleMember> = new Map();
        const fieldTypes: string[] = [];
        const initValues: string[] = [];

        // Emit struct/class definitions inside module so types are known
        moduleStatements.forEach(stmt => {
            if (stmt instanceof StructDeclaration) {
                this.visitStructDeclaration(stmt);
            } else if (stmt instanceof ClassDeclaration) {
                this.visitClassDeclaration(stmt);
            }
        });

        let index = 0;
        moduleStatements.forEach(stmt => {
            if (stmt instanceof FunctionDeclaration || stmt instanceof DeclareFunction) {
                const originalFuncName = stmt.name.lexeme;
                const mangledName = `_mod_${moduleNamePart}_${originalFuncName}`;
                const fullName = `@${mangledName}`;

                const llvmReturnType = this.llvmHelper.getLLVMType(stmt.returnType);
                const paramTypes = stmt.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
                const isSret = llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*');
                const funcParamTypes = isSret ? [ `${llvmReturnType}*`, ...paramTypes ] : paramTypes;
                const funcType = isSret
                    ? `void (${funcParamTypes.join(', ')})*`
                    : `${llvmReturnType} (${funcParamTypes.join(', ')})*`;

                if (!this.generatedFunctions.has(`${fullModulePath}.${originalFuncName}`)) {
                    const savedPath = this.sourceFilePath;
                    const savedMangleFlag = this.mangleStdLib;
                    this.sourceFilePath = fullModulePath;
                    this.mangleStdLib = false;
                    if (stmt instanceof FunctionDeclaration) {
                        stmt.isExported = true;
                        this.visitFunctionDeclaration(stmt);
                    } else {
                        if (isSret) {
                            const sretAlign = this.llvmHelper.getAlign(llvmReturnType);
                            const paramsString = [ `ptr sret(${llvmReturnType}) align ${sretAlign}`, ...paramTypes ].filter(p => p.length > 0).join(', ');
                            this.emit(`declare void ${fullName}(${paramsString})`, false);
                        } else {
                            const paramsString = paramTypes.join(', ');
                            this.emit(`declare ${llvmReturnType} ${fullName}(${paramsString})`, false);
                        }
                    }
                    this.sourceFilePath = savedPath;
                    this.mangleStdLib = savedMangleFlag;
                    this.generatedFunctions.add(`${fullModulePath}.${originalFuncName}`);
                }

                members.set(originalFuncName, { llvmType: funcType, index, ptr: fullName });
                fieldTypes.push(funcType);
                initValues.push(`${funcType} ${fullName}`);
                index++;
            }
        });

        this.emit(`${structName} = type { ${fieldTypes.join(', ')} }`, false);
        this.emit(`${globalName} = internal global ${structName} { ${initValues.join(', ')} }`, false);

        this.moduleObjects.set(fullModulePath, {
            structName,
            globalName,
            members,
            initialized: true
        });
    }

    private concatStrings(left: IRValue, right: IRValue): IRValue {
        // Load lengths
        const leftLenPtr = this.llvmHelper.getNewTempVar();
        const leftLen = this.llvmHelper.getNewTempVar();
        this.emit(`${leftLenPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${left.value}, i32 0, i32 ${LangItems.string.members.len.index}`);
        this.emit(`${leftLen} = load i64, i64* ${leftLenPtr}, align 8`);

        const rightLenPtr = this.llvmHelper.getNewTempVar();
        const rightLen = this.llvmHelper.getNewTempVar();
        this.emit(`${rightLenPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${right.value}, i32 0, i32 ${LangItems.string.members.len.index}`);
        this.emit(`${rightLen} = load i64, i64* ${rightLenPtr}, align 8`);

        // Compute total length
        const totalLen = this.llvmHelper.getNewTempVar();
        this.emit(`${totalLen} = add i64 ${leftLen}, ${rightLen}`);

        // Allocate buffer via syscall brk bump allocator (no libc)
        const totalLenWithNull = this.llvmHelper.getNewTempVar();
        this.emit(`${totalLenWithNull} = add i64 ${totalLen}, 1`);
        const sizeToAlloc = totalLenWithNull;
        this.ensureHeapGlobals();

        // Initialize heap brk if needed
        const initFlag = this.llvmHelper.getNewTempVar();
        this.emit(`${initFlag} = load i1, i1* @__heap_initialized, align 1`);
        const isInitEnd = this.getNewLabel('heap.init.end');
        const isInitDo = this.getNewLabel('heap.init.do');
        this.emit(`br i1 ${initFlag}, label %${isInitEnd}, label %${isInitDo}`);

        // init do block
        this.emit(`${isInitDo}:`, false);
        this.indentLevel++;
        const currentBrk = this.llvmHelper.getNewTempVar();
        this.emit(`${currentBrk} = call i64 @__syscall6(i64 12, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        const currentBrkPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${currentBrkPtr} = inttoptr i64 ${currentBrk} to i8*`);
        this.emit(`store i8* ${currentBrkPtr}, i8** @__heap_brk, align 8`);
        this.emit(`store i1 true, i1* @__heap_initialized, align 1`);
        this.emit(`br label %${isInitEnd}`);
        this.indentLevel--;

        // init end block
        this.emit(`${isInitEnd}:`, false);

        // Allocate
        const oldBrk = this.llvmHelper.getNewTempVar();
        this.emit(`${oldBrk} = load i8*, i8** @__heap_brk, align 8`);
        const nextBrk = this.llvmHelper.getNewTempVar();
        this.emit(`${nextBrk} = getelementptr inbounds i8, i8* ${oldBrk}, i64 ${sizeToAlloc}`);
        const nextBrkInt = this.llvmHelper.getNewTempVar();
        this.emit(`${nextBrkInt} = ptrtoint i8* ${nextBrk} to i64`);
        const setBrkRes = this.llvmHelper.getNewTempVar();
        this.emit(`${setBrkRes} = call i64 @__syscall6(i64 12, i64 ${nextBrkInt}, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        const setBrkPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${setBrkPtr} = inttoptr i64 ${setBrkRes} to i8*`);
        this.emit(`store i8* ${setBrkPtr}, i8** @__heap_brk, align 8`);
        const destPtr = oldBrk; // allocation start

        // Copy left
        const leftDataPtrPtr = this.llvmHelper.getNewTempVar();
        const leftDataPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${leftDataPtrPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${left.value}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
        this.emit(`${leftDataPtr} = load i8*, i8** ${leftDataPtrPtr}, align 8`);
        const copyLeft = this.builtins.createMemcpy(destPtr, leftDataPtr, leftLen);
        this.emit(copyLeft);

        // Copy right to dest + leftLen
        const destRight = this.llvmHelper.getNewTempVar();
        this.emit(`${destRight} = getelementptr inbounds i8, i8* ${destPtr}, i64 ${leftLen}`);
        const rightDataPtrPtr = this.llvmHelper.getNewTempVar();
        const rightDataPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${rightDataPtrPtr} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${right.value}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
        this.emit(`${rightDataPtr} = load i8*, i8** ${rightDataPtrPtr}, align 8`);
        const copyRight = this.builtins.createMemcpy(destRight, rightDataPtr, rightLen);
        this.emit(copyRight);

        // Add null terminator
        const nullTerminatorPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${nullTerminatorPtr} = getelementptr inbounds i8, i8* ${destPtr}, i64 ${totalLen}`);
        this.emit(`store i8 0, i8* ${nullTerminatorPtr}, align 1`);

        // Build result string struct on stack
        const resultStructPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${resultStructPtr} = alloca ${LangItems.string.structName}, align 8`);
        const resPtrField = this.llvmHelper.getNewTempVar();
        this.emit(`${resPtrField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
        this.emit(`store i8* ${destPtr}, i8** ${resPtrField}, align 8`);
        const resLenField = this.llvmHelper.getNewTempVar();
        this.emit(`${resLenField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.len.index}`);
        this.emit(`store i64 ${totalLen}, i64* ${resLenField}, align 8`);

        return { value: resultStructPtr, type: `${LangItems.string.structName}*` };
    }

    // Ensure an IRValue representing a string is a pointer to the string struct.
    public ensureStringPointer(val: IRValue): IRValue | null {
        const structType = LangItems.string.structName;
        const ptrType = `${structType}*`;
        if (val.type === ptrType) return val;
        if (val.type === structType) {
            const tmpPtr = this.llvmHelper.getNewTempVar();
            this.emit(`${tmpPtr} = alloca ${structType}, align ${this.llvmHelper.getAlign(structType)}`);
            this.emit(`store ${structType} ${val.value}, ${structType}* ${tmpPtr}, align ${this.llvmHelper.getAlign(structType)}`);
            return { value: tmpPtr, type: ptrType };
        }
        return null;
    }

    private coerceValue(value: IRValue, targetType: string): IRValue {
        if (value.type === targetType) return value;

        const converted = this.llvmHelper.getNewTempVar();
        const srcType = value.type;
        const dstType = targetType;

        const isSrcInt = srcType.startsWith('i') && !srcType.endsWith('*');
        const isDstInt = dstType.startsWith('i') && !dstType.endsWith('*');
        const isSrcFloat = srcType.startsWith('f');
        const isDstFloat = dstType.startsWith('f');
        const isSrcPtr = srcType.endsWith('*');
        const isDstPtr = dstType.endsWith('*');

        if (isSrcInt && isDstInt) {
            const srcBits = parseInt(srcType.slice(1), 10);
            const dstBits = parseInt(dstType.slice(1), 10);
            if (dstBits > srcBits) {
                this.emit(`${converted} = sext ${srcType} ${value.value} to ${dstType}`);
            } else if (dstBits < srcBits) {
                this.emit(`${converted} = trunc ${srcType} ${value.value} to ${dstType}`);
            } else {
                this.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
            }
        } else if (isSrcFloat && isDstFloat) {
            const srcBits = parseInt(srcType.slice(1), 10);
            const dstBits = parseInt(dstType.slice(1), 10);
            if (dstBits > srcBits) {
                this.emit(`${converted} = fpext ${srcType} ${value.value} to ${dstType}`);
            } else if (dstBits < srcBits) {
                this.emit(`${converted} = fptrunc ${srcType} ${value.value} to ${dstType}`);
            } else {
                this.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
            }
        } else if (isSrcInt && isDstFloat) {
            this.emit(`${converted} = sitofp ${srcType} ${value.value} to ${dstType}`);
        } else if (isSrcFloat && isDstInt) {
            this.emit(`${converted} = fptosi ${srcType} ${value.value} to ${dstType}`);
        } else if (isSrcPtr && isDstPtr) {
            this.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
        } else if (isSrcInt && isDstPtr) {
            this.emit(`${converted} = inttoptr ${srcType} ${value.value} to ${dstType}`);
        } else if (isSrcPtr && isDstInt) {
            this.emit(`${converted} = ptrtoint ${srcType} ${value.value} to ${dstType}`);
        } else {
            this.emit(`${converted} = bitcast ${srcType} ${value.value} to ${dstType}`);
        }

        return { value: converted, type: targetType };
    }

    // --- Expression Visitor methods ---

    visitAddressOfExpr(expr: AddressOfExpr): IRValue {
        // Evaluate the inner expression to get its storage location
        // This is typically for local variables (alloca'd) or global variables
        if (expr.expression instanceof IdentifierExpr) {
            const varName = expr.expression.name.lexeme;
            const entry = this.currentScope.find(varName);
            if (!entry) {
                throw new Error(`无法获取未声明变量 '${varName}' 的地址。`);
            }
            const ptrType = `${entry.llvmType}*`;
            const asInt = this.llvmHelper.getNewTempVar();
            this.emit(`${asInt} = ptrtoint ${ptrType} ${entry.ptr} to i64`);
            return { value: asInt, type: 'i64', ptr: entry.ptr, ptrType };
        } else if (expr.expression instanceof GetExpr) {
            // Getting address of a property, e.g., &obj.prop
            const objectInfo = expr.expression.object.accept(this);
            const memberName = expr.expression.name.lexeme;

            const isPointer = objectInfo.type.endsWith('*');
            const baseType = isPointer ? objectInfo.type.slice(0, -1) : objectInfo.type;

            if (!baseType.startsWith('%struct.')) {
                 throw new Error(`无法获取非结构体类型属性 '${memberName}' 的地址: ${objectInfo.type}`);
            }

            const className = baseType.substring('%struct.'.length);
            const classEntry = this.classDefinitions.get(className);
            if (!classEntry) {
                throw new Error(`未定义类型 '${className}' 的类定义。`);
            }

            const memberEntry = classEntry.members.get(memberName);
            if (!memberEntry) {
                throw new Error(`类 '${className}' 中未定义成员 '${memberName}'。`);
            }
            
            const memberPtrVar = this.llvmHelper.getNewTempVar();
            if (isPointer) { // Object itself is a pointer (e.g., class instance)
                this.emit(`${memberPtrVar} = getelementptr inbounds ${classEntry.llvmType}, ${objectInfo.type} ${objectInfo.value}, i32 0, i32 ${memberEntry.index}`);
            } else { // Object is a struct value (passed by value)
                // This case is tricky. If objectInfo.value is the struct value, we need its *address* first.
                // For simplicity, let's assume getting address of properties is primarily for pointer-like objects.
                throw new Error(`尚不支持获取值类型结构体属性 '${memberName}' 的地址。`);
            }
            const asInt = this.llvmHelper.getNewTempVar();
            this.emit(`${asInt} = ptrtoint ${memberEntry.llvmType}* ${memberPtrVar} to i64`);
            return { value: asInt, type: 'i64', ptr: memberPtrVar, ptrType: `${memberEntry.llvmType}*` };

        }
        throw new Error(`无法获取表达式 '${expr.expression.constructor.name}' 的地址。`);
    }

    visitDereferenceExpr(expr: DereferenceExpr): IRValue {
        const ptrValue = expr.expression.accept(this); // This should yield an IRValue where type is a pointer type (e.g., i32*)
        let ptrType = ptrValue.type;
        let ptrVar = ptrValue.value;

        if (!ptrType.endsWith('*')) {
            if (ptrType === 'i64' && ptrValue.ptr) {
                ptrVar = ptrValue.ptr;
                ptrType = ptrValue.ptrType || 'i8*';
            } else {
                throw new Error(`解引用操作符 '*' 只能用于指针类型，但得到了 '${ptrValue.type}'。`);
            }
        }

        const baseType = ptrType.slice(0, -1); // Remove '*' to get the base type
        const resultVar = this.llvmHelper.getNewTempVar();
        this.emit(`${resultVar} = load ${baseType}, ${ptrType} ${ptrVar}, align ${this.llvmHelper.getAlign(baseType)}`);
        return { value: resultVar, type: baseType, address: ptrVar };
    }

    visitLiteralExpr(expr: LiteralExpr): IRValue {
        if (typeof expr.value === 'number') {
            if (Number.isInteger(expr.value)) return { value: `${expr.value}`, type: 'i64' }; // 默认整数推断为 i64
            return { value: `${expr.value}`, type: 'f64' };
        }
        if (typeof expr.value === 'string') {
            // Updated to handle managed strings
            const globalString = this.llvmHelper.createGlobalString(expr.value);
            // For a literal, we can directly use the global constant struct.
            // When assigning to a local variable, a copy should be made on the stack.
            // This IRValue should represent the pointer to the global string struct.
            return { value: globalString.stringStructGlobalName, type: `${LangItems.string.structName}*` };
        }
        if (typeof expr.value === 'boolean') {
            return { value: expr.value ? '1' : '0', type: 'i1' };
        }
        return { value: 'null', type: 'void' };
    }
    
    visitIdentifierExpr(expr: IdentifierExpr): IRValue {
        const name = expr.name.lexeme;

        // 检查是否为捕获的变量
        if (this.currentFunction && this.currentFunction.capturedVariables) {
            const captured = (this.currentFunction.capturedVariables as CapturedVariableInfo[]).find(v => v.name === name);
            if (captured) {
                // 这是一个捕获的变量，通过环境指针访问它
                const envEntry = this.currentScope.find('__env_ptr');
                if (!envEntry) {
                    throw new Error("内部错误：在作用域中未找到闭包环境指针 '__env_ptr'。");
                }
                const envPtr = envEntry.ptr; // 这是环境指针的值, 例如 %arg0
                const envStructType = envEntry.llvmType.slice(0, -1); // 从指针类型获取结构体类型

                const capturedIndex = (this.currentFunction.capturedVariables as CapturedVariableInfo[]).findIndex(v => v.name === name);

                // 1. 获取指向环境结构体中保存我们变量指针的字段的指针
                const envFieldPtr = this.llvmHelper.getNewTempVar();
                this.emit(`${envFieldPtr} = getelementptr inbounds ${envStructType}, ${envEntry.llvmType} ${envPtr}, i32 0, i32 ${capturedIndex}`);

                // 2. 从环境字段中加载我们变量的指针
                const capturedVarAddrPtr = this.llvmHelper.getNewTempVar();
                const capturedVarType = captured.llvmType; // 例如, i32
                const capturedVarPtrType = `${capturedVarType}*`; // 例如, i32*
                this.emit(`${capturedVarAddrPtr} = load ${capturedVarPtrType}, ${capturedVarPtrType}* ${envFieldPtr}, align 8`);

                // 3. 使用加载的指针加载变量的实际值
                const loadedValue = this.llvmHelper.getNewTempVar();
                this.emit(`${loadedValue} = load ${capturedVarType}, ${capturedVarPtrType} ${capturedVarAddrPtr}, align ${this.llvmHelper.getAlign(capturedVarType)}`);

                return { value: loadedValue, type: capturedVarType, address: capturedVarAddrPtr };
            }
        }

        if (this.debug) console.log("Looking up identifier:", name, "in scope depth:", this.currentScope.depth);
        const entry = this.currentScope.find(name);
        
        if (!entry) {
            if (this.debug) console.log("ERROR: Identifier not found:", name);
            // Special handling for 'syscall' intrinsic
            if (name === 'syscall') {
                return { value: '__syscall6', type: 'internal_syscall' }; // Use internal syscall wrapper
            }
            throw new Error(`Undefined variable or function: ${name}`); // This is the error being thrown
        }
        if (this.debug) console.log("Found identifier:", name, "entry:", entry);

        // Module globals and function pointers are already pointers, their 'ptr' is their 'value'
        // For these, the 'value' *is* the pointer/address, so we don't need a separate 'address' field.
        if (entry.llvmType === 'module') {
             return { value: entry.ptr, type: entry.llvmType };
        }
        if (entry.llvmType.endsWith(')*')) { // function pointer
            if (entry.ptr.startsWith('@')) {
                return { value: entry.ptr, type: entry.llvmType };
            }
            const loadedFunc = this.llvmHelper.getNewTempVar();
            this.emit(`${loadedFunc} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
            return { value: loadedFunc, type: entry.llvmType, address: entry.ptr };
        }

        // Module globals (structs)
        for (const info of this.moduleObjects.values()) {
            if (entry.ptr === info.globalName) { // e.g. @module_io, its type is %struct.module_io*
                // Here, entry.ptr is the address of the global module struct.
                // The 'value' should be this address, and 'address' should also be this address.
                return { value: info.globalName, type: `${info.structName}*`, address: info.globalName };
            }
        }

        const tempVar = this.llvmHelper.getNewTempVar();
        // `entry.ptr` 是变量在栈上（alloca）或全局（global）的存储地址。
        // `entry.llvmType` 是该变量本身的 LLVM 类型 (例如 i32*, %struct.String, i32)。
        // 我们需要加载 `entry.ptr` 指向的“值”。
        this.emit(`${tempVar} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
        
        // 返回的 IRValue 包含加载出的值，值的类型，以及变量本身的存储地址。
        return { value: tempVar, type: entry.llvmType, address: entry.ptr };
    }

    visitBinaryExpr(expr: BinaryExpr): IRValue {
        const left = expr.left.accept(this) as IRValue;
        const right = expr.right.accept(this) as IRValue;
        const resultVar = this.llvmHelper.getNewTempVar();

        switch (expr.operator.type) {
            case TokenType.PLUS:
                // Built-in string concatenation
                {
                    const leftStr = this.ensureStringPointer(left);
                    const rightStr = this.ensureStringPointer(right);
                    if (leftStr && rightStr) {
                        return this.concatStrings(leftStr, rightStr);
                    }
                }

                // Numeric addition
                this.emit(`${resultVar} = add nsw ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: left.type };

            case TokenType.MINUS:
                this.emit(`${resultVar} = sub nsw ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: left.type };
            case TokenType.STAR:
                this.emit(`${resultVar} = mul nsw ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: left.type };
            case TokenType.SLASH:
                this.emit(`${resultVar} = sdiv ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: left.type };
            
            // Comparison operators
            case TokenType.EQ_EQ:
                this.emit(`${resultVar} = icmp eq ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: 'i1' };
            case TokenType.BANG_EQ:
                this.emit(`${resultVar} = icmp ne ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: 'i1' };
            case TokenType.GT:
                this.emit(`${resultVar} = icmp sgt ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: 'i1' };
            case TokenType.GT_EQ:
                this.emit(`${resultVar} = icmp sge ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: 'i1' };
            case TokenType.LT:
                this.emit(`${resultVar} = icmp slt ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: 'i1' };
            case TokenType.LT_EQ:
                this.emit(`${resultVar} = icmp sle ${left.type} ${left.value}, ${right.value}`);
                return { value: resultVar, type: 'i1' };

            default:
                throw new Error(`Unsupported binary operator: ${expr.operator.lexeme}`);
        }
    }

    visitUnaryExpr(expr: UnaryExpr): IRValue {
        const right = expr.right.accept(this) as IRValue;
        const resultVar = this.llvmHelper.getNewTempVar();

        switch (expr.operator.type) {
            case TokenType.MINUS: // Negation
                this.emit(`${resultVar} = sub nsw ${right.type} 0, ${right.value}`);
                return { value: resultVar, type: right.type };
            case TokenType.BANG: // Logical not
                this.emit(`${resultVar} = xor i1 ${right.value}, 1`);
                return { value: resultVar, type: 'i1' };
            default:
                throw new Error(`Unsupported unary operator: ${expr.operator.lexeme}`);
        }
    }

    visitGroupingExpr(expr: GroupingExpr): IRValue {
        return expr.expression.accept(this);
    }

    visitCallExpr(expr: CallExpr): IRValue {
        // Special case for `addrof` to get the address of a variable directly.
        if (expr.callee instanceof IdentifierExpr && expr.callee.name.lexeme === 'addrof') {
            if (expr.args.length !== 1 || !(expr.args[0] instanceof IdentifierExpr)) {
                throw new Error("addrof() requires exactly one argument, which must be a variable name.");
            }
            const varName = (expr.args[0] as IdentifierExpr).name.lexeme;
            const entry = this.currentScope.find(varName);
            if (!entry) {
                throw new Error(`Undefined variable: ${varName}`);
            }

            // `addrof` now always returns the address of the stack variable.
            const resultVar = this.llvmHelper.getNewTempVar();
            this.emit(`${resultVar} = ptrtoint ${entry.llvmType}* ${entry.ptr} to i64`);
            return { value: resultVar, type: 'i64' };
        }

        // Handle predefined/builtin functions directly
        if (expr.callee instanceof IdentifierExpr) {
            const predefined = findPredefinedFunction(expr.callee.name.lexeme);
            if (predefined) {
                const evaluatedArgs = expr.args.map(a => a.accept(this) as IRValue);
                return predefined.handler(this, evaluatedArgs);
            }
        }

        let calleeInfo = expr.callee.accept(this) as IRValue;
        const argValues = expr.args.map(arg => arg.accept(this) as IRValue);

        // --- 闭包调用处理 ---
        // 如果被调用者是一个闭包对象 (即 { func*, env* }* 类型),
        // 我们需要解构它以获取真正的函数指针和环境指针。
        if (calleeInfo.type.startsWith('{') && calleeInfo.type.endsWith('}*')) {
            const closureObjPtr = calleeInfo.value;
            const closureObjType = calleeInfo.type.slice(0, -1);
            if (this.debug) console.log(`Unwrap closure: objPtr=${closureObjPtr}, objType=${closureObjType}`);

            // 1. 从闭包对象中加载函数指针 (位于字段 0)
            const funcPtrFieldPtr = this.llvmHelper.getNewTempVar();
            this.emit(`${funcPtrFieldPtr} = getelementptr inbounds ${closureObjType}, ${calleeInfo.type} ${closureObjPtr}, i32 0, i32 0`);
            
            // 从结构体类型字符串中提取函数指针和环境指针类型
            const fields = this.splitStructFields(closureObjType);
            if (fields.length < 2) {
                throw new Error(`无法从闭包对象类型中提取字段类型: ${closureObjType}`);
            }
            const loadedFuncPtrType = fields[0]!; // Already ends with '*'
            const loadedFuncPtr = this.llvmHelper.getNewTempVar();
            this.emit(`${loadedFuncPtr} = load ${loadedFuncPtrType}, ${loadedFuncPtrType}* ${funcPtrFieldPtr}, align 8`);
            
            // 2. 从闭包对象中加载环境指针 (位于字段 1)
            const envPtrFieldPtr = this.llvmHelper.getNewTempVar();
            this.emit(`${envPtrFieldPtr} = getelementptr inbounds ${closureObjType}, ${calleeInfo.type} ${closureObjPtr}, i32 0, i32 1`);

            const loadedEnvPtrType = fields[1]!;
            const loadedEnvPtr = this.llvmHelper.getNewTempVar();
            this.emit(`${loadedEnvPtr} = load ${loadedEnvPtrType}, ${loadedEnvPtrType}* ${envPtrFieldPtr}, align 8`);
            
            // 3. 更新 calleeInfo 并将环境指针作为第一个参数
            calleeInfo = { value: loadedFuncPtr, type: loadedFuncPtrType };
            argValues.unshift({ value: loadedEnvPtr, type: loadedEnvPtrType });
        }
        // --- 结束闭包调用处理 ---

        const funcRef = calleeInfo.value; // The callable reference (function symbol or pointer)

        // Special-case syscall intrinsic
        if (calleeInfo.type === 'internal_syscall' || calleeInfo.value === '__syscall6') {
            // syscall(number[, arg1..arg6]) -> i64
            const syscallArgs: string[] = argValues.map(a => this.ensureI64(a));
            while (syscallArgs.length < 7) syscallArgs.push('0');

            const resultVar = this.llvmHelper.getNewTempVar();
            const argList = syscallArgs.slice(0, 7).map(a => `i64 ${a}`).join(', ');
            this.emit(`${resultVar} = call i64 @__syscall6(${argList})`);
            return { value: resultVar, type: 'i64' };
        }

        // Inject implicit 'this' for method calls (if provided by GetExpr)
        if (calleeInfo.classInstancePtr) {
            argValues.unshift({
                value: calleeInfo.classInstancePtr,
                type: calleeInfo.classInstancePtrType || 'i8*'
            });
        }

        if (this.debug) console.log(`Call candidate: callee=${calleeInfo.value}, type=${calleeInfo.type}`);
        const typeStr = calleeInfo.type.trim();
        if (!typeStr.endsWith('*')) {
            console.error(`Call target not a function pointer: callee=${calleeInfo.value}, type=${calleeInfo.type}`);
            throw new Error(`Attempted to call a non-function type: ${calleeInfo.type} (callee: ${calleeInfo.value})`);
        }

        // Parse function type string like "ret (param1, param2)*" even when params are function pointers.
        const withoutStar = typeStr.slice(0, -1).trim(); // drop trailing '*'
        const lastParen = withoutStar.lastIndexOf(')');
        let paramListStart = -1;
        let scanDepth = 0;
        for (let i = lastParen; i >= 0; i--) {
            const ch = withoutStar[i];
            if (ch === ')') scanDepth++;
            else if (ch === '(') {
                scanDepth--;
                if (scanDepth === 0) {
                    paramListStart = i;
                    break;
                }
            }
        }

        if (paramListStart < 0 || lastParen < paramListStart) {
            throw new Error(`Attempted to call a non-function type: ${calleeInfo.type} (callee: ${calleeInfo.value})`);
        }
        const returnType = withoutStar.slice(0, paramListStart).trim();
        const paramTypesRaw = withoutStar.slice(paramListStart + 1, lastParen);

        // Split parameters while respecting nested parentheses in function-pointer params.
        const paramTypes: string[] = [];
        let current = '';
        let depth = 0;
        for (const ch of paramTypesRaw) {
            if (ch === ',' && depth === 0) {
                if (current.trim().length > 0) paramTypes.push(current.trim());
                current = '';
                continue;
            }
            if (ch === '(' || ch === '{' || ch === '[') depth++;
            if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
            current += ch;
        }
        if (current.trim().length > 0) paramTypes.push(current.trim());

        if (this.debug) console.log(`Call: callee=${calleeInfo.value}, type=${calleeInfo.type}, ret=${returnType}, params=[${paramTypes.join(', ')}]`);
        
        let callArgs: string[] = [];

        // Handle SRET-style functions (void return with first param as struct pointer)
        let sretPtrVar: string | null = null;
        let sretParamType: string | null = null;
        let effectiveParamTypes = paramTypes;
        const firstParam = paramTypes[0];
        const isSretFunc = (returnType === 'void' && firstParam && firstParam.startsWith('%struct.') && firstParam.endsWith('*'));
        if (isSretFunc) {
            sretParamType = firstParam;
            const structType = firstParam.slice(0, -1);
            sretPtrVar = this.llvmHelper.getNewTempVar();
            this.emit(`${sretPtrVar} = alloca ${structType}, align ${this.llvmHelper.getAlign(structType)}`);
            callArgs.push(`${firstParam} ${sretPtrVar}`);
            effectiveParamTypes = paramTypes.slice(1);
        }

        argValues.forEach((arg, idx) => {
            const expectedParam = effectiveParamTypes[idx]; // The expected LLVM type for this parameter
            let argValue = arg.value;
            let argType = arg.type;

            // 如果参数数量不匹配，或者没有期望的参数类型，我们跳过隐式引用，但仍会尝试类型转换
            if (!expectedParam) {
                callArgs.push(`${argType} ${argValue}`); // If no expected type, pass as-is after conversions
                return;
            }

            // --- PARAMETER PASSING SEMANTICS & IMPLICIT REFERENCING ---
            // 规则1: 如果函数期望 T*，而传入的是 T，则自动获取地址。
            if (expectedParam.endsWith('*') && !argType.endsWith('*')) {
                const expectedBaseType = expectedParam.slice(0, -1); // 期望的基础类型
                // 检查基础类型是否匹配 (例如，期望 i32*，传入 i32)
                if (expectedBaseType === argType) {
                    if (!arg.address) {
                        // 如果参数是字面量或表达式结果，没有直接地址，
                        // 则在栈上分配临时空间存储值，然后传递该临时空间的地址。
                        const tempAlloca = this.llvmHelper.getNewTempVar();
                        this.emit(`${tempAlloca} = alloca ${argType}, align ${this.llvmHelper.getAlign(argType)}`);
                        this.emit(`store ${argType} ${argValue}, ${argType}* ${tempAlloca}, align ${this.llvmHelper.getAlign(argType)}`);
                        argValue = tempAlloca; // 现在 argValue 是临时 alloca 的指针
                    } else {
                        // 如果参数有直接地址 (例如，它本身就是个变量)，则使用其地址。
                        argValue = arg.address;
                    }
                    argType = expectedParam; // 现在参数类型是期望的指针类型
                }
            }
            // --- END PARAMETER PASSING SEMANTICS & IMPLICIT REFERENCING ---


            // --- 类型转换 (T to expectedParam) ---
            if (expectedParam !== argType) {
                // Struct pointer -> struct value (load)
                if (expectedParam.startsWith('%struct.') && !expectedParam.endsWith('*') && argType === `${expectedParam}*`) {
                    const loadedStruct = this.llvmHelper.getNewTempVar();
                    this.emit(`${loadedStruct} = load ${expectedParam}, ${expectedParam}* ${argValue}, align ${this.llvmHelper.getAlign(expectedParam)}`);
                    argValue = loadedStruct;
                    argType = expectedParam;
                } else {
                const convertedArg = this.llvmHelper.getNewTempVar();
                const currentArgType = argType;
                const currentArgValue = argValue;

                const isCurrentInt = currentArgType.startsWith('i');
                const isExpectedInt = expectedParam.startsWith('i');
                const isCurrentFloat = currentArgType.startsWith('f');
                const isExpectedFloat = expectedParam.startsWith('f');
                const isCurrentPtr = currentArgType.endsWith('*');
                const isExpectedPtr = expectedParam.endsWith('*');

                if (isCurrentInt && isExpectedInt) {
                    const currentBits = parseInt(currentArgType.slice(1), 10);
                    const expectedBits = parseInt(expectedParam.slice(1), 10);
                    if (expectedBits > currentBits) {
                        this.emit(`${convertedArg} = sext ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    } else if (expectedBits < currentBits) {
                        this.emit(`${convertedArg} = trunc ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    } else { // Same bit width, but possibly different sign handling (though LLVM handles iN types uniformly for bitcast)
                        this.emit(`${convertedArg} = bitcast ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    }
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentFloat && isExpectedFloat) {
                    const currentBits = parseInt(currentArgType.slice(1), 10);
                    const expectedBits = parseInt(expectedParam.slice(1), 10);
                    if (expectedBits > currentBits) { // e.g., f32 to f64
                        this.emit(`${convertedArg} = fpext ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    } else if (expectedBits < currentBits) { // e.g., f64 to f32
                        this.emit(`${convertedArg} = fptrunc ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    }
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentInt && isExpectedFloat) { // int to float
                    this.emit(`${convertedArg} = sitofp ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentFloat && isExpectedInt) { // float to int
                    this.emit(`${convertedArg} = fptosi ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentPtr && isExpectedPtr) { // pointer to pointer bitcast
                    this.emit(`${convertedArg} = bitcast ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentInt && isExpectedPtr) { // int to pointer
                    this.emit(`${convertedArg} = inttoptr ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (isCurrentPtr && isExpectedInt) { // pointer to int
                    this.emit(`${convertedArg} = ptrtoint ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                    argValue = convertedArg;
                    argType = expectedParam;
                } else if (currentArgType.startsWith('%struct.') && expectedParam.startsWith('%struct.')) {
                    // Struct to struct conversion (e.g. from string literal constant to local string struct)
                    // If the current arg is a pointer to struct, and expected is a struct VALUE, we need to load.
                    // This scenario is mostly handled by implicit referencing.
                    // If it's a direct struct value to struct value, a bitcast might be needed if types are just nominal.
                    // For now, assume implicit referencing handles the common case.
                    // If currentArgType is %struct.foo* and expectedParam is %struct.bar, implies a load then bitcast value or error.
                    // For now, if types are literally different struct types, throw error unless specific conversion is defined.
                    // Or implicitly bitcast if compatible by size. For now, we will rely on strict type matching unless explicit casts.
                } else {
                    // Fallback for unhandled conversions
                    // throw new Error(`无法转换类型从 ${currentArgType} 到 ${expectedParam}。`);
                    // For robustness, allow bitcast as a last resort, assuming LLVM will validate.
                    if (currentArgType !== expectedParam) { // Only if genuinely different
                        this.emit(`${convertedArg} = bitcast ${currentArgType} ${currentArgValue} to ${expectedParam}`);
                        argValue = convertedArg;
                        argType = expectedParam;
                    }
                }
                }
            }
            // --- END 类型转换 ---
            callArgs.push(`${argType} ${argValue}`);
        });

        const callInstr = `call ${returnType} ${funcRef}(${callArgs.join(', ')})`;

        if (returnType === 'void') {
            this.emit(callInstr);
            if (sretPtrVar && sretParamType) {
                return { value: sretPtrVar, type: `${sretParamType}` };
            }
            return { value: '', type: 'void' };
        }

        const resultVar = this.llvmHelper.getNewTempVar();
        this.emit(`${resultVar} = ${callInstr}`);
        return { value: resultVar, type: returnType };
    }

    visitAssignExpr(expr: AssignExpr): IRValue {
        const value = expr.value.accept(this) as IRValue; // Evaluate the right-hand side first

        if (expr.target instanceof IdentifierExpr) {
            const varName = expr.target.name.lexeme;

            // Handle captured variable assignment inside closures
            if (this.currentFunction && this.currentFunction.capturedVariables) {
                const captured = (this.currentFunction.capturedVariables as CapturedVariableInfo[]).find(v => v.name === varName);
                if (captured) {
                    const envEntry = this.currentScope.find('__env_ptr');
                    if (!envEntry) throw new Error("内部错误：在作用域中未找到闭包环境指针 '__env_ptr'。");
                    const envPtr = envEntry.ptr;
                    const envStructType = envEntry.llvmType.slice(0, -1);
                    const capturedIndex = (this.currentFunction.capturedVariables as CapturedVariableInfo[]).findIndex(v => v.name === varName);

                    const envFieldPtr = this.llvmHelper.getNewTempVar();
                    this.emit(`${envFieldPtr} = getelementptr inbounds ${envStructType}, ${envEntry.llvmType} ${envPtr}, i32 0, i32 ${capturedIndex}`);

                    const capturedVarPtr = this.llvmHelper.getNewTempVar();
                    const capturedVarPtrType = `${captured.llvmType}*`;
                    this.emit(`${capturedVarPtr} = load ${capturedVarPtrType}, ${capturedVarPtrType}* ${envFieldPtr}, align 8`);

                    const coerced = value.type === captured.llvmType ? value : this.coerceValue(value, captured.llvmType);
                    this.emit(`store ${captured.llvmType} ${coerced.value}, ${capturedVarPtrType} ${capturedVarPtr}, align ${this.llvmHelper.getAlign(captured.llvmType)}`);
                    return coerced;
                }
            }

            const entry = this.currentScope.find(varName);
            if (!entry) {
                throw new Error(`Assignment to undeclared variable: ${varName}`);
            }
            let toStore = value;
            if (value.type === `${entry.llvmType}*` && entry.llvmType.startsWith('%struct.') && !entry.llvmType.endsWith('*')) {
                const loadedStruct = this.llvmHelper.getNewTempVar();
                this.emit(`${loadedStruct} = load ${entry.llvmType}, ${entry.llvmType}* ${value.value}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
                toStore = { value: loadedStruct, type: entry.llvmType };
            } else if (value.type !== entry.llvmType) {
                toStore = this.coerceValue(value, entry.llvmType);
            }
            this.emit(`store ${entry.llvmType} ${toStore.value}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
            return toStore;
        } else if (expr.target instanceof GetExpr) { // Handle object.property = value
            const objectInfo = expr.target.object.accept(this) as IRValue; // Evaluate object (e.g., 'this')
            const memberName = expr.target.name.lexeme; // Get property name

            // Get class definition for the object
            const objectTypeMatch = objectInfo.type.match(/%struct\.([a-zA-Z0-9_]+)\*/);
            if (!objectTypeMatch || !objectTypeMatch[1]) {
                throw new Error(`Cannot assign to property '${memberName}' of non-struct type: ${objectInfo.type}`);
            }
            const className = objectTypeMatch[1];
            
            const classEntry = this.classDefinitions.get(className);
            if (!classEntry) {
                throw new Error(`Undefined class definition for type: ${objectInfo.type}`);
            }

            const memberEntry = classEntry.members.get(memberName);
            if (!memberEntry) {
                throw new Error(`Undefined member '${memberName}' in class '${className}' for assignment.`);
            }

            // Get pointer to the member
            const memberPtrVar = this.llvmHelper.getNewTempVar();
            this.emit(`${memberPtrVar} = getelementptr inbounds ${classEntry.llvmType}, ${objectInfo.type} ${objectInfo.value}, i32 0, i32 ${memberEntry.index}`);
            
            // Store the value into the member
            const coerced = (value.type === `${memberEntry.llvmType}*` && memberEntry.llvmType.startsWith('%struct.'))
                ? (() => {
                    const loaded = this.llvmHelper.getNewTempVar();
                    this.emit(`${loaded} = load ${memberEntry.llvmType}, ${memberEntry.llvmType}* ${value.value}, align ${this.llvmHelper.getAlign(memberEntry.llvmType)}`);
                    return { value: loaded, type: memberEntry.llvmType };
                })()
                : (value.type === memberEntry.llvmType ? value : this.coerceValue(value, memberEntry.llvmType));
            this.emit(`store ${memberEntry.llvmType} ${coerced.value}, ${memberEntry.llvmType}* ${memberPtrVar}, align ${this.llvmHelper.getAlign(memberEntry.llvmType)}`);
            return coerced;

        } else if (expr.target instanceof DereferenceExpr) { // Handle *ptr = value
            const targetPtr = expr.target.expression.accept(this); // Evaluate `ptr` in `*ptr`
            
            if (!targetPtr.type.endsWith('*')) {
                throw new Error(`无法赋值给非指针类型 '${targetPtr.type}' 的解引用结果。`);
            }
            // The base type of the pointer is the type of the value being stored.
            const baseType = targetPtr.type.slice(0, -1); 

            const coerced = value.type === baseType ? value : this.coerceValue(value, baseType);
            this.emit(`store ${baseType} ${coerced.value}, ${targetPtr.type} ${targetPtr.value}, align ${this.llvmHelper.getAlign(baseType)}`);
            return coerced;
        } else {
            throw new Error(`Invalid assignment target: ${expr.target.constructor.name}`);
        }
    }
    
    // --- StmtVisitor methods ---

    visitExpressionStmt(stmt: ExpressionStmt): void {
        stmt.expression.accept(this); // Consume result
    }

    visitLetStmt(stmt: LetStmt): void {
        // Check if this is a global or local variable
        if (this.currentScope === this.globalScope) {
            this.visitGlobalLetStmt(stmt);
        } else {
            this.visitLocalLetStmt(stmt);
        }
    }

    visitConstStmt(stmt: ConstStmt): void { // NEW: visitConstStmt
        const varName = stmt.name.lexeme;
        const mangledName = `@${varName}`;
        const llvmType = this.llvmHelper.getLLVMType(stmt.type);
        const linkage = stmt.isExported ? '' : 'internal ';

        let initialValue = 'zeroinitializer'; // Default for global const
        if (stmt.initializer) {
            if (stmt.initializer instanceof LiteralExpr) {
                const literal = this.visitLiteralExpr(stmt.initializer);
                initialValue = literal.value;
            } else {
                throw new Error("Global constant initializers must be constant literals.");
            }
        }
        
        this.globalScope.define(varName, {
            llvmType: llvmType,
            ptr: mangledName,
            isPointer: llvmType.endsWith('*'),
            definedInScopeDepth: this.currentScope.depth
        });
    }
    
    visitGlobalLetStmt(stmt: LetStmt): void {
        const varName = stmt.name.lexeme;
        const mangledName = `@${varName}`;
        const llvmType = this.llvmHelper.getLLVMType(stmt.type);
        const linkage = stmt.isExported ? '' : 'internal ';

        let initialValue = '0';
        if (stmt.initializer) {
            if (stmt.initializer instanceof LiteralExpr) {
                const literal = this.visitLiteralExpr(stmt.initializer);
                initialValue = literal.value;
            } else {
                throw new Error("Global variable initializers must be constant literals.");
            }
        }
        
        this.emit(`${mangledName} = ${linkage}global ${llvmType} ${initialValue}, align ${this.llvmHelper.getAlign(llvmType)}`, false);

        this.globalScope.define(varName, {
            llvmType: llvmType,
            ptr: mangledName,
            isPointer: llvmType.endsWith('*'),
            definedInScopeDepth: this.currentScope.depth
        });
    }

    visitLocalLetStmt(stmt: LetStmt): void {
        const varName = stmt.name.lexeme;
        let llvmType: string;
        let initValue: IRValue | null = null;

        if (stmt.initializer) {
            initValue = stmt.initializer.accept(this);
        }

        if (stmt.type) { // 显式类型注解
            llvmType = this.llvmHelper.getLLVMType(stmt.type);
        } else if (initValue) { // 从初始化器推断类型
            // 字符串字面量推断为值类型 string（结构体）
            if (initValue.type === `${LangItems.string.structName}*` && !initValue.type.endsWith(')*')) { // 排除函数指针
                llvmType = LangItems.string.structName;
            } else if (initValue.ptrType) {
                // 地址推断为指针类型
                llvmType = initValue.ptrType;
            } else {
                llvmType = initValue.type;
            }
        } else {
            throw new Error(`变量 '${varName}' 声明时必须指定类型或提供初始化器。`);
        }

        if (this.debug) console.log(`Let ${varName} inferred LLVM type: ${llvmType}, initValue.type: ${initValue ? initValue.type : 'null'}`);

        const varPtr = `%${varName}`;
        this.emit(`${varPtr} = alloca ${llvmType}, align ${this.llvmHelper.getAlign(llvmType)}`);
        
        this.currentScope.define(varName, {
            llvmType: llvmType,
            ptr: varPtr,
            isPointer: llvmType.endsWith('*'),
            definedInScopeDepth: this.currentScope.depth
        });

        if (initValue) {
            // 如果初始化器是结构体指针 (%struct.String*) 且变量是结构体值 (%struct.String)
            if (initValue.type === `${llvmType}*` && !llvmType.endsWith('*') && llvmType.startsWith('%struct.')) {
                const loadedStruct = this.llvmHelper.getNewTempVar();
                this.emit(`${loadedStruct} = load ${llvmType}, ${llvmType}* ${initValue.value}, align ${this.llvmHelper.getAlign(llvmType)}`);
                this.emit(`store ${llvmType} ${loadedStruct}, ${llvmType}* ${varPtr}, align ${this.llvmHelper.getAlign(llvmType)}`);
            } else {
                const coerced = this.coerceValue(initValue, llvmType);
                this.emit(`store ${llvmType} ${coerced.value}, ${llvmType}* ${varPtr}, align ${this.llvmHelper.getAlign(llvmType)}`);
            }
        }
    }

    visitBlockStmt(stmt: BlockStmt): void {
        this.enterScope();
        stmt.statements.forEach(s => s.accept(this));
        this.exitScope();
    }
    
    visitIfStmt(stmt: IfStmt): void {
        const condition = stmt.condition.accept(this);
        if (condition.type !== 'i1') {
            throw new Error('If condition must be a boolean expression.');
        }

        const thenLabel = this.getNewLabel('if.then');
        const elseLabel = this.getNewLabel('if.else');
        const endLabel = this.getNewLabel('if.end');

        const finalDest = stmt.elseBranch ? elseLabel : endLabel;
        this.emit(`br i1 ${condition.value}, label %${thenLabel}, label %${finalDest}`);

        this.emit(`${thenLabel}:`, false);
        this.indentLevel++;
        stmt.thenBranch.accept(this);
        this.emit(`br label %${endLabel}`);
        this.indentLevel--;

        if (stmt.elseBranch) {
            this.emit(`${elseLabel}:`, false);
            this.indentLevel++;
            stmt.elseBranch.accept(this);
            this.emit(`br label %${endLabel}`);
            this.indentLevel--;
        }

        this.emit(`${endLabel}:`, false);
    }

    visitWhileStmt(stmt: WhileStmt): void {
        const headerLabel = this.getNewLabel('while.header');
        const bodyLabel = this.getNewLabel('while.body');
        const endLabel = this.getNewLabel('while.end');

        this.emit(`br label %${headerLabel}`);

        this.emit(`${headerLabel}:`, false);
        this.indentLevel++;
        const condition = stmt.condition.accept(this);
        if (condition.type !== 'i1') {
            throw new Error('While condition must be a boolean expression.');
        }
        this.emit(`br i1 ${condition.value}, label %${bodyLabel}, label %${endLabel}`);
        this.indentLevel--;

        this.emit(`${bodyLabel}:`, false);
        this.indentLevel++;
        stmt.body.accept(this);
        this.emit(`br label %${headerLabel}`);
        this.indentLevel--;

        this.emit(`${endLabel}:`, false);
    }

    visitReturnStmt(stmt: ReturnStmt): void {
        if (!this.currentFunction) {
            throw new Error("Return statement outside of a function.");
        }
        const funcReturnType = this.llvmHelper.getLLVMType(this.currentFunction.returnType);
        
        if (stmt.value) {
            const retVal = stmt.value.accept(this);
            
            if (this.sretPointer) {
                // SRET convention: copy the struct pointed to by retVal.value into the sret pointer
                // retVal.value is expected to be a pointer to the struct to be returned (e.g., %struct.string*)

                const structSize = 16; // Hardcoding for %struct.string size (8 bytes for ptr, 8 for len)
                const sizeOfStructI64 = `${structSize}`;

                // Bitcast both pointers to i8* for memcpy
                const destPtr = this.sretPointer;
                const srcPtr = retVal.value;
                
                const destI8Ptr = this.llvmHelper.getNewTempVar();
                const srcI8Ptr = this.llvmHelper.getNewTempVar();

                this.emit(`${destI8Ptr} = bitcast ptr ${destPtr} to i8*`);
                this.emit(`${srcI8Ptr} = bitcast ${retVal.type} ${srcPtr} to i8*`);
                
                const call = this.builtins.createMemcpy(destI8Ptr, srcI8Ptr, sizeOfStructI64);
                this.emit(call);
                this.emit(`ret void`);
            } else {
                // 如果返回值类型与函数签名不一致，进行必要的转换
                let retValType = retVal.type;
                let retValValue = retVal.value;

                if (funcReturnType !== retValType) {
                    const conv = this.llvmHelper.getNewTempVar();
                    const isRetInt = funcReturnType.startsWith('i') && !funcReturnType.endsWith('*');
                    const isValInt = retValType.startsWith('i') && !retValType.endsWith('*');
                    const isRetPtr = funcReturnType.endsWith('*');
                    const isValPtr = retValType.endsWith('*');

                    if (isRetInt && isValInt) {
                        const retBits = parseInt(funcReturnType.slice(1), 10);
                        const valBits = parseInt(retValType.slice(1), 10);
                        if (valBits < retBits) {
                            this.emit(`${conv} = sext ${retValType} ${retValValue} to ${funcReturnType}`);
                        } else if (valBits > retBits) {
                            this.emit(`${conv} = trunc ${retValType} ${retValValue} to ${funcReturnType}`);
                        } else {
                            this.emit(`${conv} = bitcast ${retValType} ${retValValue} to ${funcReturnType}`);
                        }
                    } else if (isRetPtr && isValPtr) {
                        this.emit(`${conv} = bitcast ${retValType} ${retValValue} to ${funcReturnType}`);
                    } else if (isRetPtr && isValInt) {
                        this.emit(`${conv} = inttoptr ${retValType} ${retValValue} to ${funcReturnType}`);
                    } else if (isRetInt && isValPtr) {
                        this.emit(`${conv} = ptrtoint ${retValType} ${retValValue} to ${funcReturnType}`);
                    } else {
                        this.emit(`${conv} = bitcast ${retValType} ${retValValue} to ${funcReturnType}`);
                    }
                    retValType = funcReturnType;
                    retValValue = conv;
                }

                this.emit(`ret ${retValType} ${retValValue}`);
            }
        } else {
            this.emit(`ret void`);
        }
    }

    visitFunctionDeclaration(decl: FunctionDeclaration): void {
        const key = this.getFunctionKey(decl);
        if (!this.declaredSymbols.has(key)) {
            this.declareFunctionSymbol(decl);
            this.declaredSymbols.add(key);
        }
        if (!this.generatedFunctions.has(key)) {
            this.emitFunctionDefinition(decl);
            this.generatedFunctions.add(key);
        }
    }

    public declareFunctionSymbol(decl: FunctionDeclaration): void {
        this.currentFunction = decl; // Temporarily set currentFunction for context
        const originalFuncName = decl.name.lexeme;
        let funcNameInIR = originalFuncName;

        if (this.debug) console.log("Declaring symbol for function:", originalFuncName);
        
        // Determine mangled name for global functions
        if (decl.isExported) {
            const relativeSourcePath = path.relative(process.cwd(), this.sourceFilePath);
            const moduleNamePart = relativeSourcePath.replace(/\.yu$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            funcNameInIR = `_mod_${moduleNamePart}_${originalFuncName}`;
        } else if (this.mangleStdLib && originalFuncName !== 'main') {
            funcNameInIR = `_prog_${originalFuncName}`;
        }

        // Handle class method mangling
        // For declaration phase, 'this' context might not be fully established,
        // but we assume mangling is consistent.
        if (decl.visibility && decl.visibility.lexeme) { // Check if it's a class method (heuristic)
            // This part is complex because decl.visibility alone is not enough to know it's a method.
            // For now, let's assume methods are handled by their class declaration in emitGlobalDefinitions.
            // If this is a local function definition, funcNameInIR should be unique per scope.
            // But we are only defining global symbols here.
        }
        const mangledName = `@${funcNameInIR}`;

        // Determine LLVM return type
        let llvmReturnType = this.llvmHelper.getLLVMType(decl.returnType);
        let isSretReturn = false;
        if (llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*')) {
            isSretReturn = true;
            llvmReturnType = 'void'; // Effective return type for SRET
        }

        // Determine parameter types for signature
        let signatureParamTypesOnly: string[] = [];

        // Add 'this' parameter for class methods (if applicable, based on decl context)
        // This is tricky in the first pass as full scope context is not established.
        // For now, assume a method's signature is inferred from its declaration in ClassDeclaration.
        // During emitFunctionDefinition, we'll confirm 'this' is present.
        
        // Add SRET parameter if needed
        if (isSretReturn) {
            signatureParamTypesOnly.push(`${this.llvmHelper.getLLVMType(decl.returnType)}*`); // SRET pointer type
        }

        // Add user-defined parameters
        decl.parameters.forEach(p => {
            let paramType = this.llvmHelper.getLLVMType(p.type);
            if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
                paramType = `${paramType}*`;
            }
            signatureParamTypesOnly.push(paramType);
        });

        const funcType = `${llvmReturnType} (${signatureParamTypesOnly.join(', ')})*`; // Full function pointer type

        this.globalScope.define(originalFuncName, { llvmType: funcType, ptr: mangledName, isPointer: true, definedInScopeDepth: this.globalScope.depth });
        if (this.debug) console.log("Declared symbol:", originalFuncName, "mangled:", mangledName, "type:", funcType);
    }

    public emitFunctionDefinition(decl: FunctionDeclaration): void {
        this.currentFunction = decl;
        const originalFuncName = decl.name.lexeme;
        let funcNameInIR = originalFuncName;

        if (this.debug) console.log("Emitting definition for function:", originalFuncName);

        // Re-determine mangled name (must be consistent with declareFunctionSymbol)
        if (decl.isExported) {
            const relativeSourcePath = path.relative(process.cwd(), this.sourceFilePath);
            const moduleNamePart = relativeSourcePath.replace(/\.yu$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            funcNameInIR = `_mod_${moduleNamePart}_${originalFuncName}`;
        } else if (this.mangleStdLib && originalFuncName !== 'main') {
            funcNameInIR = `_prog_${originalFuncName}`;
        }

        // Handle class method mangling
        const isClassMethod = (this.currentScope !== this.globalScope && decl.visibility && decl.visibility.lexeme);
        if (isClassMethod) {
            const thisEntry = this.currentScope.find("this");
            if (thisEntry && thisEntry.llvmType.startsWith('%struct.')) {
                const classNameMatch = thisEntry.llvmType.match(/%struct\.([a-zA-Z0-9_]+)\*/);
                if (classNameMatch && classNameMatch[1]) {
                    const className = classNameMatch[1];
                    funcNameInIR = `_cls_${className}_${originalFuncName}`; // Use class method mangling
                }
            }
        }
        const mangledName = `@${funcNameInIR}`;

        const linkage = (originalFuncName === 'main' || decl.isExported) ? '' : 'internal ';
        
        let llvmReturnType = this.llvmHelper.getLLVMType(decl.returnType);
        let isSretReturn = false;
        if (llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*')) {
            isSretReturn = true;
            llvmReturnType = 'void';
        }

        let signatureParamsList: string[] = [];
        let sretArgName: string | null = null;
        this.sretPointer = null;

        if (isSretReturn) {
            sretArgName = `%agg.result`;
            signatureParamsList.push(`ptr sret(${this.llvmHelper.getLLVMType(decl.returnType)}) align ${this.llvmHelper.getAlign(this.llvmHelper.getLLVMType(decl.returnType))} ${sretArgName}`);
            this.sretPointer = sretArgName;
        }

        const hasImplicitThis = isClassMethod; // If it's a class method, it has 'this'
        if (hasImplicitThis) {
            // Re-use info from define, assume it exists correctly from class setup
            const classEntry = this.classDefinitions.get(this.currentScope.find("this")?.llvmType.slice(8, -1) || '');
            if (classEntry) {
                signatureParamsList.push(`${classEntry.llvmType}* %this`);
            } else {
                signatureParamsList.push(`i8* %this`); // Fallback if class not found
            }
        }

        decl.parameters.forEach(p => {
            let paramType = this.llvmHelper.getLLVMType(p.type);
            if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
                paramType = `${paramType}*`;
            }
            signatureParamsList.push(`${paramType} %${p.name.lexeme}`);
        });

        const paramsString = signatureParamsList.join(', ');
        
        this.emit(`define ${linkage}${llvmReturnType} ${mangledName}(${paramsString}) {`, false);
        this.indentLevel++;
        this.emit('entry:', false);
        this.enterScope();

        if (isSretReturn && sretArgName) {
            this.currentScope.define(sretArgName, {
                llvmType: `${this.llvmHelper.getLLVMType(decl.returnType)}*`,
                ptr: sretArgName,
                isPointer: true,
                definedInScopeDepth: this.currentScope.depth
            });
        }

        if (hasImplicitThis) {
            const thisEntry = this.currentScope.find("this"); // From outer class scope
            if (thisEntry) {
                const thisPtr = `%this.ptr`;
                const thisLlvmType = thisEntry.llvmType; // This will be %struct.MyClass*
                this.emit(`${thisPtr} = alloca ${thisLlvmType}, align ${this.llvmHelper.getAlign(thisLlvmType)}`);
                this.emit(`store ${thisLlvmType} %this, ${thisLlvmType}* ${thisPtr}, align ${this.llvmHelper.getAlign(thisLlvmType)}`);
                this.currentScope.define("this", { // Overwrite with alloca'd ptr
                    llvmType: thisLlvmType,
                    ptr: thisPtr,
                    isPointer: true,
                    definedInScopeDepth: this.currentScope.depth
                });
            }
        }

        decl.parameters.forEach(p => {
            let paramType = this.llvmHelper.getLLVMType(p.type);
            if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
                paramType = `${paramType}*`;
            }
            const paramName = p.name.lexeme;
            const paramPtr = `%p.${paramName}`;
            const incomingArgName = `%${paramName}`;
            
            this.emit(`${paramPtr} = alloca ${paramType}, align ${this.llvmHelper.getAlign(paramType)}`);
            this.emit(`store ${paramType} ${incomingArgName}, ${paramType}* ${paramPtr}, align ${this.llvmHelper.getAlign(paramType)}`);
            
            this.currentScope.define(paramName, {
                llvmType: paramType,
                ptr: paramPtr,
                isPointer: paramType.endsWith('*'),
                definedInScopeDepth: this.currentScope.depth
            });
        });

        decl.body.accept(this);
        
        const lastLine = this.builder[this.builder.length - 1];
        if (lastLine !== undefined && !lastLine.trim().startsWith('ret ') && !lastLine.trim().startsWith('br ')) {
             if (llvmReturnType === 'void') {
                this.emit(`ret void`);
            } else {
                this.emit(`unreachable`);
            }
        }

        this.exitScope();
        this.indentLevel--;
        this.emit('}', false);
        this.emit('', false);
        this.currentFunction = null;
        this.sretPointer = null;
    }

    visitClassDeclaration(stmt: ClassDeclaration): void {
        const className = stmt.name.lexeme;
        const structName = (className === LangItems.string.className)
            ? LangItems.string.structName
            : `%struct.${className}`;

        const fields: string[] = [];
        const membersMap: Map<string, MemberEntry> = new Map();
        const methodsMap: Map<string, FunctionDeclaration> = new Map();

        stmt.properties.forEach((p, index) => {
            const memberType = this.llvmHelper.getLLVMType(p.type);
            fields.push(memberType);
            membersMap.set(p.name.lexeme, { llvmType: memberType, index: index });
        });
        
        stmt.methods.forEach(m => {
            methodsMap.set(m.name.lexeme, m);
        });

        this.emit(`${structName} = type { ${fields.join(', ')} }`, false);

        this.classDefinitions.set(className, {
            llvmType: structName,
            members: membersMap,
            methods: methodsMap
        });

        // Emit method definitions
        stmt.methods.forEach(method => {
            const savedScope = this.currentScope;
            // Create a scope that contains 'this' so FunctionDeclaration treats it as a method
            const methodScope = new Scope(this.globalScope);
            methodScope.define("this", {
                llvmType: `${structName}*`,
                ptr: '%this',
                isPointer: true,
                definedInScopeDepth: methodScope.depth
            });
            this.currentScope = methodScope;
            this.visitFunctionDeclaration(method);
            this.currentScope = savedScope;
        });
    }

    visitStructDeclaration(decl: StructDeclaration): void { // NEW
        const structName = `%struct.${decl.name.lexeme}`;

        const fields: string[] = [];
        const membersMap: Map<string, MemberEntry> = new Map();

        decl.properties.forEach((p: PropertyDeclaration, index: number) => {
            const memberType = this.llvmHelper.getLLVMType(p.type);
            fields.push(memberType);
            membersMap.set(p.name.lexeme, { llvmType: memberType, index: index });
        });
        
        this.emit(`${structName} = type { ${fields.join(', ')} }`, false);

        // Store struct definition for member access later
        // Re-using classDefinitions map, but structs won't have methods
        this.classDefinitions.set(decl.name.lexeme, {
            llvmType: structName,
            members: membersMap,
            methods: new Map() // Structs don't have methods
        });
    }

    // --- Unimplemented methods (with correct signatures) ---
        visitGetExpr(expr: GetExpr): IRValue {
            const objectInfo = expr.object.accept(this);
            const memberName = expr.name.lexeme;

            // Module object access
            const moduleInfo = (() => {
                for (const info of this.moduleObjects.values()) {
                    if (objectInfo.type === `${info.structName}*`) return info;
                    if (objectInfo.ptr && info.globalName === objectInfo.ptr) return info;
                }
                return null;
            })();

            if (moduleInfo) {
                const member = moduleInfo.members.get(memberName);
                if (!member) {
                    throw new Error(`Undefined member '${memberName}' in module object.`);
                }
                const memberPtrVar = this.llvmHelper.getNewTempVar();
                this.emit(`${memberPtrVar} = getelementptr inbounds ${moduleInfo.structName}, ${moduleInfo.structName}* ${objectInfo.value}, i32 0, i32 ${member.index}`);
                const loaded = this.llvmHelper.getNewTempVar();
                this.emit(`${loaded} = load ${member.llvmType}, ${member.llvmType}* ${memberPtrVar}, align ${this.llvmHelper.getAlign(member.llvmType)}`);
                return { value: loaded, type: member.llvmType };
            }

            // Lang Item: string.length will now be handled as a regular method/property access
            // This assumes 'string' has a 'length' method/property defined in std.yu and imported.


            // --- General struct member access ---
            const isPointer = objectInfo.type.endsWith('*');
            const baseType = isPointer ? objectInfo.type.slice(0, -1) : objectInfo.type;

            if (!baseType.startsWith('%struct.')) {
                 throw new Error(`Cannot get property '${memberName}' of non-struct type: ${objectInfo.type}`);
            }

            const className = baseType.substring('%struct.'.length);
            const classEntry = this.classDefinitions.get(className);
            if (!classEntry) {
                throw new Error(`Undefined class definition for type: ${objectInfo.type}`);
            }

            // Check for methods
            const methodEntry = classEntry.methods.get(memberName);
            if (methodEntry) {
                const returnType = this.llvmHelper.getLLVMType(methodEntry.returnType);
                const paramsList = methodEntry.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
                const instancePtrType = `${classEntry.llvmType}*`;
                let funcType: string;
                if (returnType.startsWith('%struct.') && !returnType.endsWith('*')) {
                    funcType = `void (${returnType}*, ${instancePtrType}${paramsList.length ? ', ' + paramsList.join(', ') : ''})*`;
                } else {
                    funcType = `${returnType} (${instancePtrType}${paramsList.length ? ', ' + paramsList.join(', ') : ''})*`;
                }
                const mangledName = `_cls_${className}_${methodEntry.name.lexeme}`;
                return { value: `@${mangledName}`, type: funcType, classInstancePtr: objectInfo.value, classInstancePtrType: objectInfo.type };
            }

            // Check for properties
            const memberEntry = classEntry.members.get(memberName);
            if (!memberEntry) {
                throw new Error(`Undefined member '${memberName}' in class '${className}'`);
            }
            
            let resultVar: string;
            if (isPointer) {
                const memberPtrVar = this.llvmHelper.getNewTempVar();
                this.emit(`${memberPtrVar} = getelementptr inbounds ${classEntry.llvmType}, ${objectInfo.type} ${objectInfo.value}, i32 0, i32 ${memberEntry.index}`);
                resultVar = this.llvmHelper.getNewTempVar();
                this.emit(`${resultVar} = load ${memberEntry.llvmType}, ${memberEntry.llvmType}* ${memberPtrVar}, align ${this.llvmHelper.getAlign(memberEntry.llvmType)}`);
            } else {
                 resultVar = this.llvmHelper.getNewTempVar();
                 this.emit(`${resultVar} = extractvalue ${objectInfo.type} ${objectInfo.value}, ${memberEntry.index}`);
            }

            return { value: resultVar, type: memberEntry.llvmType };
        }
    visitNewExpr(expr: NewExpr): IRValue {
        // Determine class name from callee (Identifier or GetExpr with module prefix)
        let className: string | null = null;
        if (expr.callee instanceof IdentifierExpr) {
            className = expr.callee.name.lexeme;
        } else if (expr.callee instanceof GetExpr) {
            className = expr.callee.name.lexeme;
        }
        if (!className) {
            throw new Error("new expression requires a class identifier");
        }

        const classEntry = this.classDefinitions.get(className);
        if (!classEntry) {
            throw new Error(`Undefined class for new: ${className}`);
        }

        // Compute size via GEP null,1 trick
        const sizePtr = this.llvmHelper.getNewTempVar();
        this.emit(`${sizePtr} = getelementptr inbounds ${classEntry.llvmType}, ${classEntry.llvmType}* null, i32 1`);
        const sizeInt = this.llvmHelper.getNewTempVar();
        this.emit(`${sizeInt} = ptrtoint ${classEntry.llvmType}* ${sizePtr} to i64`);

        // Heap allocate (same as _builtin_alloc)
        this.ensureHeapGlobals();
        const initFlag = this.llvmHelper.getNewTempVar();
        this.emit(`${initFlag} = load i1, i1* @__heap_initialized, align 1`);
        const initEnd = this.getNewLabel('heap.init.end.new');
        const initDo = this.getNewLabel('heap.init.do.new');
        this.emit(`br i1 ${initFlag}, label %${initEnd}, label %${initDo}`);

        this.emit(`${initDo}:`, false);
        this.indentLevel++;
        const curBrk = this.llvmHelper.getNewTempVar();
        this.emit(`${curBrk} = call i64 @__syscall6(i64 12, i64 0, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        const curBrkPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${curBrkPtr} = inttoptr i64 ${curBrk} to i8*`);
        this.emit(`store i8* ${curBrkPtr}, i8** @__heap_brk, align 8`);
        this.emit(`store i1 true, i1* @__heap_initialized, align 1`);
        this.emit(`br label %${initEnd}`);
        this.indentLevel--;

        this.emit(`${initEnd}:`, false);
        const oldBrk = this.llvmHelper.getNewTempVar();
        this.emit(`${oldBrk} = load i8*, i8** @__heap_brk, align 8`);
        const nextBrk = this.llvmHelper.getNewTempVar();
        this.emit(`${nextBrk} = getelementptr inbounds i8, i8* ${oldBrk}, i64 ${sizeInt}`);
        const nextBrkInt = this.llvmHelper.getNewTempVar();
        this.emit(`${nextBrkInt} = ptrtoint i8* ${nextBrk} to i64`);
        const brkRes = this.llvmHelper.getNewTempVar();
        this.emit(`${brkRes} = call i64 @__syscall6(i64 12, i64 ${nextBrkInt}, i64 0, i64 0, i64 0, i64 0, i64 0)`);
        const brkPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${brkPtr} = inttoptr i64 ${brkRes} to i8*`);
        this.emit(`store i8* ${brkPtr}, i8** @__heap_brk, align 8`);

        // Typed pointer to object
        const objPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${objPtr} = bitcast i8* ${oldBrk} to ${classEntry.llvmType}*`);

        // Call constructor if exists
        const ctor = classEntry.methods.get('constructor');
        if (ctor) {
            const returnType = this.llvmHelper.getLLVMType(ctor.returnType);
            const paramTypes = ctor.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
            const funcName = `_cls_${className}_constructor`;

            const argValues = expr.args.map(a => a.accept(this) as IRValue);

            const callArgs: string[] = [];
            // this
            callArgs.push(`${classEntry.llvmType}* ${objPtr}`);
            // user args with basic casts (only int widening and ptr bitcast)
            argValues.forEach((arg, idx) => {
                const expected = paramTypes[idx] || arg.type;
                let val = arg.value;
                let typ = arg.type;
                if (expected !== typ) {
                    if (expected.endsWith('*') && typ.endsWith('*')) {
                        const casted = this.llvmHelper.getNewTempVar();
                        this.emit(`${casted} = bitcast ${typ} ${val} to ${expected}`);
                        val = casted; typ = expected;
                    } else if (expected === 'i64' && typ === 'i32') {
                        const sext = this.llvmHelper.getNewTempVar();
                        this.emit(`${sext} = sext i32 ${val} to i64`);
                        val = sext; typ = 'i64';
                    }
                }
                callArgs.push(`${expected || typ} ${val}`);
            });

            if (returnType.startsWith('%struct.') && !returnType.endsWith('*')) {
                const retTmp = this.llvmHelper.getNewTempVar();
                this.emit(`${retTmp} = alloca ${returnType}, align ${this.llvmHelper.getAlign(returnType)}`);
                callArgs.unshift(`${returnType}* ${retTmp}`);
                this.emit(`call void @_cls_${className}_constructor(${callArgs.join(', ')})`);
            } else {
                this.emit(`call ${returnType} @_cls_${className}_constructor(${callArgs.join(', ')})`);
            }
        }

        return { value: objPtr, type: `${classEntry.llvmType}*` };
    }

    visitDeleteExpr(expr: DeleteExpr): IRValue {
        const target = expr.target.accept(this);
        // Only free heap objects allocated via our brk bump allocator.
        if (target.type.endsWith('*')) {
            const ptrAsI8 = this.llvmHelper.getNewTempVar();
            this.emit(`${ptrAsI8} = bitcast ${target.type} ${target.value} to i8*`);
            // naive free: reset heap break if this is the top allocation
            const curBrk = this.llvmHelper.getNewTempVar();
            this.emit(`${curBrk} = load i8*, i8** @__heap_brk, align 8`);
            const cmpTop = this.llvmHelper.getNewTempVar();
            this.emit(`${cmpTop} = icmp eq i8* ${ptrAsI8}, ${curBrk}`);
            const endLbl = this.getNewLabel('free.end');
            const doLbl = this.getNewLabel('free.do');
            this.emit(`br i1 ${cmpTop}, label %${doLbl}, label %${endLbl}`);
            this.emit(`${doLbl}:`, false);
            this.indentLevel++;
            const ptrInt = this.llvmHelper.getNewTempVar();
            this.emit(`${ptrInt} = ptrtoint i8* ${ptrAsI8} to i64`);
            this.emit(`call i64 @__syscall6(i64 12, i64 ${ptrInt}, i64 0, i64 0, i64 0, i64 0, i64 0)`);
            this.emit(`store i8* ${ptrAsI8}, i8** @__heap_brk, align 8`);
            this.indentLevel--;
            this.emit(`br label %${endLbl}`);
            this.emit(`${endLbl}:`, false);
        }
        return { value: '', type: 'void' };
    }

    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): IRValue {
        const uniqueFunctionName = this.llvmHelper.getNewUniqueName('closure_func');
        
        // Step 1: Analyze for captured variables
        // `this.currentScope` at this point is the scope *enclosing* the function literal.
        // The function literal's body will create a new scope at `this.currentScope.depth + 1`.
        const analyzer = new ClosureAnalyzer(this.currentScope, this.currentScope.depth + 1);
        expr.body.accept(analyzer); // Analyze the body of the function literal
        const capturedVariables = analyzer.getCapturedVariables();

        // Step 2 & 3: Environment struct definition and LLVM function signature
        let envStructType: string | null = null; // LLVM type of the environment struct (e.g., %struct.closure_env_func_X)
        let envStructPtrType: string | null = null; // LLVM pointer type to the environment struct (e.g., %struct.closure_env_func_X*)
        let envInstancePtr: string | null = null; // Pointer to the instance of the environment struct on heap

        // Define the environment struct if there are captured variables
        if (capturedVariables.length > 0) {
            envStructType = `%struct.closure_env_${uniqueFunctionName}`;
            const envFields = capturedVariables.map(cv => `${cv.llvmType}*`); // Environment stores pointers to captured vars
            this.emitHoisted(`${envStructType} = type { ${envFields.join(', ')} }`);
            envStructPtrType = `${envStructType}*`;
        }

        // Determine the actual LLVM function's *internal* signature (with env_ptr as first arg)
        const originalParamLlvmTypes = expr.parameters.map(p => {
            let type = this.llvmHelper.getLLVMType(p.type);
            // Apply reference passing for user-defined structs as function parameters
            if (type.startsWith('%struct.') && type !== LangItems.string.structName) {
                type = `${type}*`;
            }
            return type;
        });

        // Always include an env pointer (i8*) as first param for uniform closure calling.
        let closureFuncLlvmParams: string[] = ['i8*'];
        closureFuncLlvmParams.push(...originalParamLlvmTypes);

        const returnLlvmType = this.llvmHelper.getLLVMType(expr.returnType);
        
        // Final function type for the actual LLVM function (used in 'define')
        const actualLlvmFuncSignature = `${returnLlvmType} (${closureFuncLlvmParams.join(', ')})`;
        const closureFuncName = `@${uniqueFunctionName}`;

        // --- Store current state to restore after generating inner function ---
        const savedCurrentFunction = this.currentFunction;
        const savedCurrentScope = this.currentScope;
        const savedSretPointer = this.sretPointer;
        // --- END save state ---

        // Step 4: Emit the actual LLVM function definition (now) into a hoisted buffer
        const savedBuilder = this.builder;
        const savedIndent = this.indentLevel;
        this.builder = [];
        this.indentLevel = 0;

        // Temporarily set up context for generating the inner function
        this.currentFunction = new FunctionDeclaration(
            new Token(TokenType.IDENTIFIER, uniqueFunctionName, uniqueFunctionName, 0, 0),
            expr.parameters,
            expr.returnType,
            expr.body,
            false, // Not exported
            new Token(TokenType.PRIVATE, 'private', 'private', 0, 0), // Private linkage
            capturedVariables // Pass captured variables here
        );

        this.sretPointer = null; // Reset sret for this closure func
        
        // Create the new scope for the closure's body
        this.emit(`define internal ${returnLlvmType} ${closureFuncName}(${closureFuncLlvmParams.map((t,i) => `${t} %arg${i}`).join(', ')}) {`, false);
        this.indentLevel++;
        this.emit('entry:', false);
        this.enterScope(); // New scope for closure's parameters and body locals

        // Store environment pointer if it exists
        let envParamName: string | null = null;
        if (envStructPtrType) {
            envParamName = '%arg0'; // The first parameter is the (generic) environment pointer (i8*)
            const castedEnv = this.llvmHelper.getNewTempVar();
            this.emit(`${castedEnv} = bitcast i8* ${envParamName} to ${envStructPtrType}`);
            // Define it in the current scope for lookup, so visitIdentifierExpr can find it
            this.currentScope.define('__env_ptr', {
                llvmType: envStructPtrType,
                ptr: castedEnv,
                isPointer: true,
                definedInScopeDepth: this.currentScope.depth
            });
        } else {
            // Even without captured variables, we still have an env parameter (can be null)
            envParamName = '%arg0';
        }
        
        // Store incoming parameters into allocas in the closure's new scope
        let argIdxOffset = envStructPtrType ? 1 : 0;
        expr.parameters.forEach((p, index) => {
            const paramName = p.name.lexeme;
            let paramType = this.llvmHelper.getLLVMType(p.type);
            // Apply reference passing for user-defined structs
            if (paramType.startsWith('%struct.') && paramType !== LangItems.string.structName) {
                paramType = `${paramType}*`;
            }

            const paramAlloca = `%p.${paramName}`;
            const incomingArgName = `%arg${index + argIdxOffset}`;
            
            this.emit(`${paramAlloca} = alloca ${paramType}, align ${this.llvmHelper.getAlign(paramType)}`);
            this.emit(`store ${paramType} ${incomingArgName}, ${paramType}* ${paramAlloca}, align ${this.llvmHelper.getAlign(paramType)}`);
            
            this.currentScope.define(paramName, {
                llvmType: paramType,
                ptr: paramAlloca,
                isPointer: paramType.endsWith('*'),
                definedInScopeDepth: this.currentScope.depth
            });
        });

        // --- Core logic to handle captured variables within the closure's body ---
        // This is handled by modifying visitIdentifierExpr to check '__env_ptr' if a variable is captured.

        // Emit the body of the function literal
        expr.body.accept(this);
        
        // Ensure function always returns (even void functions need `ret void`)
        const lastLine = this.builder[this.builder.length - 1];
        if (lastLine !== undefined && !lastLine.trim().startsWith('ret ') && !lastLine.trim().startsWith('br ')) {
             if (returnLlvmType === 'void') {
                this.emit(`ret void`);
            } else {
                this.emit(`unreachable`); // Should be caught by semantic analysis usually
            }
        }

        this.exitScope(); // Exit closure's body scope
        this.indentLevel--;
        this.emit('}', false); // End of actual LLVM function definition
        this.emit('', false);

        // Capture and hoist the generated function definition, then restore state
        this.hoistFunctionDefinition(this.builder);
        this.builder = savedBuilder;
        this.indentLevel = savedIndent;
        this.currentFunction = savedCurrentFunction;
        this.currentScope = savedCurrentScope;
        this.sretPointer = savedSretPointer;
        // --- END restore state ---

        // Step 5: Construct the closure object (function pointer + environment pointer)
        // This `FunctionLiteralExpr` itself becomes an expression that evaluates to a closure object.
        
        // Allocate the environment struct on the heap and store captured variables
        if (capturedVariables.length > 0) {
            // Calculate size of environment struct
            const totalEnvSize = capturedVariables.reduce((sum, cv) => sum + this.llvmHelper.sizeOf(cv.llvmType + '*'), 0);
            
            const envRawPtr = this.llvmHelper.getNewTempVar();
            envInstancePtr = this.llvmHelper.getNewTempVar();
            this.emit(`${envRawPtr} = call i8* @yulang_malloc(i64 ${totalEnvSize})`); // Allocate environment on heap
            this.emit(`${envInstancePtr} = bitcast i8* ${envRawPtr} to ${envStructPtrType}`); // Cast to typed pointer

            capturedVariables.forEach((cv, index) => {
                // Get the address of the captured variable (which is cv.ptr)
                // Store this address (pointer to the variable) into the environment struct's field
                const envFieldPtr = this.llvmHelper.getNewTempVar();
                const cvPtrType = `${cv.llvmType}*`; // Type of the pointer to the captured variable
                this.emit(`${envFieldPtr} = getelementptr inbounds ${envStructType}, ${envStructPtrType} ${envInstancePtr}, i32 0, i32 ${index}`);
                this.emit(`store ${cvPtrType} ${cv.ptr}, ${cvPtrType}* ${envFieldPtr}, align 8`);
            });
        } else {
            envInstancePtr = 'null';
        }

        // Create the closure object on the stack (a struct of { func_ptr, env_ptr })
        // The type of this closure object is `{ actualFuncType*, envStructType }` or just `actualFuncType*` if no capture
        
        // Always build a closure object { func_ptr, i8* env_ptr }
        const closureObjLlvmType = `{ ${actualLlvmFuncSignature}*, i8* }`;
        const closureObjPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${closureObjPtr} = alloca ${closureObjLlvmType}, align 8`);

        // Store function pointer
        const funcPtrField = this.llvmHelper.getNewTempVar();
        this.emit(`${funcPtrField} = getelementptr inbounds ${closureObjLlvmType}, ${closureObjLlvmType}* ${closureObjPtr}, i32 0, i32 0`);
        this.emit(`store ${actualLlvmFuncSignature}* ${closureFuncName}, ${actualLlvmFuncSignature}** ${funcPtrField}, align 8`);

        // Store environment pointer (bitcast to i8*)
        const envPtrField = this.llvmHelper.getNewTempVar();
        this.emit(`${envPtrField} = getelementptr inbounds ${closureObjLlvmType}, ${closureObjLlvmType}* ${closureObjPtr}, i32 0, i32 1`);
        const envAsI8 = this.llvmHelper.getNewTempVar();
        const envSource = envStructPtrType ? `${envStructPtrType} ${envInstancePtr}` : `i8* ${envInstancePtr}`;
        if (envStructPtrType && envInstancePtr !== 'null') {
            this.emit(`${envAsI8} = bitcast ${envSource} to i8*`);
            this.emit(`store i8* ${envAsI8}, i8** ${envPtrField}, align 8`);
        } else {
            this.emit(`store i8* ${envInstancePtr}, i8** ${envPtrField}, align 8`);
        }

        return { value: closureObjPtr, type: `${closureObjLlvmType}*` };
    }
    visitThisExpr(expr: ThisExpr): IRValue {
        // 'this' refers to the current instance (self pointer)
        // In class methods, 'this' is typically the first implicit parameter.
        // We need to look it up from the current scope.
        const entry = this.currentScope.find("this");
        if (!entry) {
            throw new Error("Cannot use 'this' outside of a class method.");
        }
        const tempVar = this.llvmHelper.getNewTempVar();
        this.emit(`${tempVar} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
        return { value: tempVar, type: entry.llvmType };
    }

    visitAsExpr(expr: AsExpr): IRValue {
        const value = expr.expression.accept(this);
        const targetLlvmType = this.llvmHelper.getLLVMType(expr.type); // 获取目标 LLVM 类型

        const isSrcPtr = value.type.endsWith('*');
        const isDstPtr = targetLlvmType.endsWith('*');
        const dstIsIntCast = targetLlvmType.startsWith('i') && !isDstPtr;
        const dstIsFloatCast = targetLlvmType.startsWith('f');

        // New case: Dereferencing a pointer from `objof` to a value.
        // e.g., (objof(addr) as int) -> value from `i8*` to `i32`
        if (isSrcPtr && dstIsIntCast) {
            const resultVar = this.llvmHelper.getNewTempVar();
            this.emit(`${resultVar} = ptrtoint ${value.type} ${value.value} to ${targetLlvmType}`);
            return { value: resultVar, type: targetLlvmType };
        }

        if (isSrcPtr && !isDstPtr) {
            const targetPtrType = targetLlvmType + "*";

            // 1. Cast the generic pointer (likely i8* from objof) to the correct typed pointer.
            const castedPtr = this.llvmHelper.getNewTempVar();
            this.emit(`${castedPtr} = bitcast ${value.type} ${value.value} to ${targetPtrType}`);

            // 2. Load the value from the typed pointer.
            const loadedValue = this.llvmHelper.getNewTempVar();
            this.emit(`${loadedValue} = load ${targetLlvmType}, ${targetPtrType} ${castedPtr}, align ${this.llvmHelper.getAlign(targetLlvmType)}`);

            return { value: loadedValue, type: targetLlvmType };
        }
        
        if (value.type === targetLlvmType) {
            return value; // 类型相同，无需转换
        }

        const src = value.type;
        const dst = targetLlvmType;
        const resultVar = this.llvmHelper.getNewTempVar();

        const isSrcInt = src.startsWith('i');
        const isDstInt = dst.startsWith('i');
        // isSrcPtr and isDstPtr already defined above

        if (isSrcInt && isDstInt) {
            const srcBits = parseInt(src.slice(1), 10);
            const dstBits = parseInt(dst.slice(1), 10);
            if (dstBits > srcBits) {
                this.emit(`${resultVar} = sext ${src} ${value.value} to ${dst}`);
            } else if (dstBits < srcBits) {
                this.emit(`${resultVar} = trunc ${src} ${value.value} to ${dst}`);
            } else {
                this.emit(`${resultVar} = bitcast ${src} ${value.value} to ${dst}`);
            }
            return { value: resultVar, type: dst };
        }

        if (isSrcPtr && isDstPtr) {
            this.emit(`${resultVar} = bitcast ${src} ${value.value} to ${dst}`);
            return { value: resultVar, type: dst };
        }

        if (isSrcPtr && isDstInt) {
            this.emit(`${resultVar} = ptrtoint ${src} ${value.value} to ${dst}`);
            return { value: resultVar, type: dst };
        }

        if (isSrcInt && isDstPtr) {
            this.emit(`${resultVar} = inttoptr ${src} ${value.value} to ${dst}`);
            return { value: resultVar, type: dst };
        }

        // Fallback
        this.emit(`${resultVar} = bitcast ${src} ${value.value} to ${dst}`);
        return { value: resultVar, type: dst };
    }

    visitObjectLiteralExpr(expr: ObjectLiteralExpr): IRValue {
        // Compile-time sealed object literal -> unique struct type
        const literalId = this.objectLiteralCounter++;
        const structName = `%struct.object_literal_${literalId}`;
        const classKey = `object_literal_${literalId}`;

        const fields: string[] = [];
        const membersMap: Map<string, MemberEntry> = new Map();
        const valueList: IRValue[] = [];

        let index = 0;
        for (const [key, valueExpr] of expr.properties.entries()) {
            const value = valueExpr.accept(this) as IRValue;
            valueList.push(value);
            fields.push(value.type);
            membersMap.set(key.lexeme, { llvmType: value.type, index });
            index++;
        }

        // Emit struct definition if not already done
        if (!this.classDefinitions.has(classKey)) {
            this.emit(`${structName} = type { ${fields.join(', ')} }`, false);
            this.classDefinitions.set(classKey, {
                llvmType: structName,
                members: membersMap,
                methods: new Map()
            });
        }

        const objectPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${objectPtr} = alloca ${structName}, align ${this.llvmHelper.getAlign(structName)}`);

        // Store each field
        index = 0;
        for (const value of valueList) {
            const fieldPtr = this.llvmHelper.getNewTempVar();
            this.emit(`${fieldPtr} = getelementptr inbounds ${structName}, ${structName}* ${objectPtr}, i32 0, i32 ${index}`);
            this.emit(`store ${value.type} ${value.value}, ${value.type}* ${fieldPtr}, align ${this.llvmHelper.getAlign(value.type)}`);
            index++;
        }

        return { value: objectPtr, type: `${structName}*` };
    }
    
    visitPropertyDeclaration(stmt: PropertyDeclaration): void { /* Handled by ClassDeclaration */ }
    visitImportStmt(stmt: ImportStmt): void {
        const sourcePath = stmt.sourcePath.literal as string;
        const namespaceAlias = stmt.namespaceAlias ? stmt.namespaceAlias.lexeme : null;
        
        // Resolve module path (mirror declaration_parser)
        const currentFileDir = path.dirname(this.sourceFilePath);
        let fullModulePath: string;
        if (sourcePath === 'std') {
            fullModulePath = path.resolve(process.cwd(), 'src/libs/std/std.yu');
        } else if (sourcePath.startsWith('std/')) {
            const subPath = sourcePath.slice(4);
            fullModulePath = path.resolve(process.cwd(), 'src/libs/std', `${subPath}.yu`);
        } else if (sourcePath.startsWith('/')) {
            fullModulePath = path.resolve(sourcePath + '.yu');
        } else {
            fullModulePath = path.resolve(currentFileDir, sourcePath + '.yu');
        }

        // Build module object (static sealed) and place in global scope
        this.buildModuleObject(fullModulePath);

        const moduleInfo = this.moduleObjects.get(fullModulePath);
        if (!moduleInfo) {
            throw new Error(`Failed to build module object for ${fullModulePath}`);
        }

        const moduleLookupName = namespaceAlias || fullModulePath; // Use alias if present, else full path

        // This defines the variable `io` as a pointer to the module struct.
        this.globalScope.define(moduleLookupName, {
            llvmType: `${moduleInfo.structName}*`,
            ptr: moduleInfo.globalName,
            isPointer: true,
            definedInScopeDepth: this.globalScope.depth
        });
    }

    visitDeclareFunction(decl: DeclareFunction): void {
        const originalFuncName = decl.name.lexeme; // Store original name
        let funcNameInIR = originalFuncName;
        
        if (this.mangleStdLib) {
            funcNameInIR = `_prog_${funcNameInIR}`;
        }
        const mangledName = `@${funcNameInIR}`;

        const returnType = this.llvmHelper.getLLVMType(decl.returnType);
        const paramsList = decl.parameters.map(p => this.llvmHelper.getLLVMType(p.type));
        const paramsString = paramsList.join(', ');
        
        const funcType = `${returnType} (${paramsList.join(', ')})`;

        // For declared functions, we assume they are function pointers.
        this.globalScope.define(originalFuncName, { llvmType: `${funcType}*`, ptr: mangledName, isPointer: true, definedInScopeDepth: this.globalScope.depth });

        this.emit(`declare ${returnType} ${mangledName}(${paramsString})`, false);
    }

    visitUsingStmt(stmt: UsingStmt): void {
        // For now, `using` declarations don't generate any IR directly.
        // They are primarily for providing type information or linking to external libraries,
        // which would be handled in the semantic analysis or linker stages.
    }
}
