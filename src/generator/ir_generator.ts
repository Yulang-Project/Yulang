// src/generator/ir_generator.ts

import {
    ASTNode, type ExprVisitor, type StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, AssignExpr, ThisExpr, AsExpr, ObjectLiteralExpr, NewExpr, DeleteExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, UsingStmt
} from '../ast.js';
import { Token, TokenType } from '../token.js';
import { LLVMIRHelper } from './llvm_ir_helpers.js';
import { Parser } from '../parser/index.js'; // Added Parser import
import * as path from 'path'; // Added path import
import * as process from 'process'; // Added process import
import { BuiltinFunctions } from './builtins.js';
import { LangItems } from './lang_items.js';
import { findPredefinedFunction } from '../predefine/funs.js';

export type IRValue = { value: string, type: string, classInstancePtr?: string, classInstancePtrType?: string, ptr?: string };

type SymbolEntry = {
    llvmType: string; // The LLVM type of the variable (e.g., i32, i8*, %struct.MyClass*)
    ptr: string;      // The LLVM IR name of the pointer to where the variable's value is stored (e.g., %var_ptr)
    isPointer: boolean; // True if this Yulang variable is itself a pointer type (e.g., `let p: pointer(char)`)
};

// Represents a single scope (e.g., a function body, an if-block)
class Scope {
    private symbols: Map<string, SymbolEntry> = new Map();
    constructor(public parent: Scope | null = null) {}

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

    private globalScope: Scope = new Scope();
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
    private objectLiteralCounter: number = 0;
    private heapGlobalsEmitted: boolean = false;
    private lowLevelRuntimeEmitted: boolean = false;
    private moduleObjects: Map<string, { structName: string, globalName: string, members: Map<string, ModuleMember>, initialized: boolean }> = new Map();

    constructor(parser: Parser, mangleStdLib: boolean = true, sourceFilePath: string = '') { // Accept sourceFilePath parameter
        this.parser = parser;
        this.mangleStdLib = mangleStdLib;
        this.sourceFilePath = sourceFilePath; // Initialize new field
        this.builtins = new BuiltinFunctions(this.llvmHelper);
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

        nodes.forEach(node => {
            if (node instanceof FunctionDeclaration || node instanceof LetStmt || node instanceof ConstStmt || node instanceof ImportStmt || node instanceof DeclareFunction) {
                (node as Stmt).accept(this);
            }
        });

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
        nodes.forEach(node => {
            if (node instanceof ClassDeclaration || node instanceof StructDeclaration) {
                (node as Stmt).accept(this);
            }
        });
        this.builder.push("");
    }

    private enterScope(): void {
        this.currentScope = new Scope(this.currentScope);
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

    private emitLangItemStructs(): void {
        // string struct
        if (!this.classDefinitions.has(LangItems.string.className)) {
            this.emit(`${LangItems.string.structName} = type { i8*, i64, i64 }`, false);
            const members = new Map<string, MemberEntry>([
                [LangItems.string.members.ptr ? 'ptr' : 'ptr', { llvmType: 'i8*', index: LangItems.string.members.ptr.index }],
                [LangItems.string.members.len ? 'len' : 'len', { llvmType: 'i64', index: LangItems.string.members.len.index }],
                [LangItems.string.members.cap ? 'cap' : 'cap', { llvmType: 'i64', index: LangItems.string.members.cap.index }],
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
        const sizeToAlloc = totalLen; // bytes since string stores raw bytes
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

        // Build result string struct on stack
        const resultStructPtr = this.llvmHelper.getNewTempVar();
        this.emit(`${resultStructPtr} = alloca ${LangItems.string.structName}, align 8`);
        const resPtrField = this.llvmHelper.getNewTempVar();
        this.emit(`${resPtrField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
        this.emit(`store i8* ${destPtr}, i8** ${resPtrField}, align 8`);
        const resLenField = this.llvmHelper.getNewTempVar();
        this.emit(`${resLenField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.len.index}`);
        this.emit(`store i64 ${totalLen}, i64* ${resLenField}, align 8`);
        const resCapField = this.llvmHelper.getNewTempVar();
        this.emit(`${resCapField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.cap.index}`);
        this.emit(`store i64 ${totalLen}, i64* ${resCapField}, align 8`);

        return { value: resultStructPtr, type: `${LangItems.string.structName}*` };
    }

    // Ensure an IRValue representing a string is a pointer to the string struct.
    private ensureStringPointer(val: IRValue): IRValue | null {
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

    // --- Expression Visitor methods ---

    visitLiteralExpr(expr: LiteralExpr): IRValue {
        if (typeof expr.value === 'number') {
            if (Number.isInteger(expr.value)) return { value: `${expr.value}`, type: 'i64' }; // 默认整数推断为 i64
            return { value: `${expr.value}`, type: 'double' };
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
        const entry = this.currentScope.find(name);
        
        if (!entry) {
            // Special handling for 'syscall' intrinsic
            if (name === 'syscall') {
                return { value: '__syscall6', type: 'internal_syscall' }; // Use internal syscall wrapper
            }
            throw new Error(`Undefined variable or function: ${name}`);
        }

        if (entry.llvmType === 'module') {
            return { value: entry.ptr, type: 'module' };
        }

        // Module globals: return the global pointer directly (avoid double-loading)
        for (const info of this.moduleObjects.values()) {
            if (entry.ptr === info.globalName) {
                return { value: info.globalName, type: `${info.structName}*` };
            }
        }

        if (entry.llvmType.includes('(')) { // It's a function pointer
             return { value: entry.ptr, type: entry.llvmType };
        }
        
        const tempVar = this.llvmHelper.getNewTempVar();
        // 引用类型（非函数指针）：加载出指针值
        if (entry.llvmType.endsWith('*')) {
            this.emit(`${tempVar} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
            return { value: tempVar, type: entry.llvmType };
        }
        // 值类型结构体: 加载整个结构体
        if (entry.llvmType.startsWith('%struct.')) {
            this.emit(`${tempVar} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
            return { value: tempVar, type: entry.llvmType };
        }
        // 其他值类型：加载值
        this.emit(`${tempVar} = load ${entry.llvmType}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
        return { value: tempVar, type: entry.llvmType };
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

        const calleeInfo = expr.callee.accept(this) as IRValue;
        const funcRef = calleeInfo.value; // The callable reference (function symbol or pointer)
        const argValues = expr.args.map(arg => arg.accept(this) as IRValue);

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

        const funcTypeMatch = calleeInfo.type.match(/^(.*?)\((.*)\)\*$/);
        if (!funcTypeMatch || funcTypeMatch.length < 3) {
            throw new Error(`Attempted to call a non-function type: ${calleeInfo.type}`);
        }

        const returnType = funcTypeMatch[1]!.trim();
        const paramTypesRaw = funcTypeMatch[2]!.trim();
        const paramTypes = paramTypesRaw ? paramTypesRaw.split(',').map(p => p.trim()).filter(p => p.length > 0) : [];
        
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
            const expectedParam = effectiveParamTypes[idx] || arg.type; // Removed paramOffset as sret is gone
            let argValue = arg.value;
            let argType = arg.type;

            // Handle passing struct by value. The 'arg' is the struct value itself.
            if (argType.startsWith('%struct.') && expectedParam && !expectedParam.endsWith('*')) {
                callArgs.push(`${argType} ${argValue}`);
                return; // Continue to next argument
            }

            // Cast between pointer types if needed
            if (expectedParam && expectedParam !== argType && expectedParam.endsWith('*') && argType.endsWith('*')) {
                const casted = this.llvmHelper.getNewTempVar();
                this.emit(`${casted} = bitcast ${argType} ${argValue} to ${expectedParam}`);
                argValue = casted;
                argType = expectedParam;
            } else if (expectedParam && expectedParam !== argType && expectedParam === 'i64' && argType === 'i32') {
                const extended = this.llvmHelper.getNewTempVar();
                this.emit(`${extended} = sext i32 ${argValue} to i64`);
                argValue = extended;
                argType = 'i64';
            } else if (expectedParam && expectedParam !== argType && expectedParam === 'i32' && argType === 'i1') {
                const extended = this.llvmHelper.getNewTempVar();
                this.emit(`${extended} = zext i1 ${argValue} to i32`);
                argValue = extended;
                argType = 'i32';
            }

            callArgs.push(`${expectedParam || argType} ${argValue}`);
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
            const entry = this.currentScope.find(varName);
            if (!entry) {
                throw new Error(`Assignment to undeclared variable: ${varName}`);
            }
            this.emit(`store ${value.type} ${value.value}, ${entry.llvmType}* ${entry.ptr}, align ${this.llvmHelper.getAlign(entry.llvmType)}`);
            return value;
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
            this.emit(`store ${value.type} ${value.value}, ${memberEntry.llvmType}* ${memberPtrVar}, align ${this.llvmHelper.getAlign(memberEntry.llvmType)}`);
            return value;

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
        
        // Use 'constant' keyword for global constants
        this.emit(`${mangledName} = ${linkage}constant ${llvmType} ${initialValue}, align ${this.llvmHelper.getAlign(llvmType)}`, false);

        this.globalScope.define(varName, {
            llvmType: llvmType,
            ptr: mangledName,
            isPointer: llvmType.endsWith('*')
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
            isPointer: llvmType.endsWith('*')
        });
    }

    visitLocalLetStmt(stmt: LetStmt): void {
        const varName = stmt.name.lexeme;
        let llvmType: string;
        let initValue: IRValue | null = null;

        if (stmt.initializer) {
            initValue = stmt.initializer.accept(this);
        }

        if (stmt.type) {
            llvmType = this.llvmHelper.getLLVMType(stmt.type);
        } else if (initValue) {
            // 类型省略时做推断
            if (initValue.type === `${LangItems.string.structName}*`) {
                // 字符串字面量推断为值类型 string（结构体）
                llvmType = LangItems.string.structName;
            } else {
                llvmType = initValue.type;
            }
        } else {
            throw new Error(`Cannot declare variable '${varName}' without a type or an initializer.`);
        }

        const varPtr = `%${varName}`;
        this.emit(`${varPtr} = alloca ${llvmType}, align ${this.llvmHelper.getAlign(llvmType)}`);
        
        // After alloca, the type of the variable itself (the symbol) is its llvmType.
        // It's not a pointer type unless llvmType itself is a pointer.
        this.currentScope.define(varName, {
            llvmType: llvmType,
            ptr: varPtr,
            isPointer: llvmType.endsWith('*')
        });

        if (initValue) {
            // If we are storing a pointer to a struct into a struct variable (e.g. string literal init)
            if (initValue.type === `${llvmType}*`) {
                const loadedStruct = this.llvmHelper.getNewTempVar();
                this.emit(`${loadedStruct} = load ${llvmType}, ${llvmType}* ${initValue.value}, align ${this.llvmHelper.getAlign(llvmType)}`);
                this.emit(`store ${llvmType} ${loadedStruct}, ${llvmType}* ${varPtr}, align ${this.llvmHelper.getAlign(llvmType)}`);
            } else {
                this.emit(`store ${initValue.type} ${initValue.value}, ${llvmType}* ${varPtr}, align ${this.llvmHelper.getAlign(llvmType)}`);
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

                const structSize = 24; // Hardcoding for %struct.string size (8 bytes for ptr, 8 for len, 8 for cap)
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
        this.currentFunction = decl;
        const originalFuncName = decl.name.lexeme; // Store original name
        let funcNameInIR = originalFuncName;
        
        // Determine mangled name for global functions
        // All exported functions will now use a unified mangling scheme: _mod_moduleNamePart_funcName
        if (decl.isExported) { // Only exported functions get this mangling
            const relativeSourcePath = path.relative(process.cwd(), this.sourceFilePath);
            const moduleNamePart = relativeSourcePath.replace(/\.yu$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            funcNameInIR = `_mod_${moduleNamePart}_${originalFuncName}`;
        } else if (this.mangleStdLib && originalFuncName !== 'main') { // For other user-defined functions in exec target, use _prog_funcName
            funcNameInIR = `_prog_${originalFuncName}`;
        }

        // Handle class method mangling
        if (this.currentScope !== this.globalScope && decl.visibility && decl.visibility.lexeme) { // Check if it's a class method
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
        let llvmReturnType = this.llvmHelper.getLLVMType(decl.returnType); // Initial LLVM return type

        let isSretReturn = false;
        let sretPtrType: string | null = null;
        let sretArgName: string | null = null;
        this.sretPointer = null; // Reset for current function

        let signatureParamsList: string[] = []; // Parameters as they appear in the LLVM define signature
        let signatureParamTypesOnly: string[] = []; // Types for the funcType signature

        // Handle SRET (Structure Return) convention for struct returns
        if (llvmReturnType.startsWith('%struct.') && !llvmReturnType.endsWith('*')) {
            isSretReturn = true;
            sretPtrType = `${llvmReturnType}*`;
            sretArgName = `%agg.result`;
            signatureParamsList.push(`ptr sret(${llvmReturnType}) align ${this.llvmHelper.getAlign(llvmReturnType)} ${sretArgName}`); // Correct sret syntax
            signatureParamTypesOnly.push(sretPtrType); // Add sret parameter type to type list
            this.sretPointer = sretArgName; // Store for return statement
            llvmReturnType = 'void'; // Function now returns void
        }

        // Prepend 'this' parameter for class methods if applicable
        const hasImplicitThis = (this.currentScope !== this.globalScope && this.currentScope.find("this"));
        if (hasImplicitThis) {
            const thisEntry = this.currentScope.find("this");
            if (thisEntry) {
                signatureParamsList.push(`${thisEntry.llvmType} %this`); // Implicit 'this' parameter in signature
                signatureParamTypesOnly.push(thisEntry.llvmType);
            }
        }

        // Add user-defined parameters to the signature
        decl.parameters.forEach(p => {
            const paramType = this.llvmHelper.getLLVMType(p.type);
            signatureParamsList.push(`${paramType} %${p.name.lexeme}`);
            signatureParamTypesOnly.push(paramType);
        });

        const paramsString = signatureParamsList.join(', ');
        
        const funcType = `${llvmReturnType} (${signatureParamTypesOnly.join(', ')})*`; // Use modified return type and signature types

        this.globalScope.define(originalFuncName, { llvmType: funcType, ptr: mangledName, isPointer: true }); // Use originalFuncName for lookup

        this.emit(`define ${linkage}${llvmReturnType} ${mangledName}(${paramsString}) {`, false); // Use modified return type and paramsString
        this.indentLevel++;

        this.emit('entry:', false);
        this.enterScope();

        // Register the sret pointer in the current scope if applicable
        if (isSretReturn && sretArgName && sretPtrType) {
            this.currentScope.define(sretArgName, {
                llvmType: sretPtrType, // Store the pointer type for SRET arg in symbol table.
                ptr: sretArgName,
                isPointer: true
            });
        }

        // --- Store incoming arguments into allocated local variables ---
        let currentLlvmArgIndex = 0; // LLVM arguments start from %0

        // Account for SRET argument in numbering
        if (isSretReturn) {
            // SRET parameter (%agg.result) is at index 0 in LLVM IR argument list. It is handled by its explicit name.
            // We use named arguments for everything else so we don't need to track index here.
        }
        
        // Account for 'this' argument
        if (hasImplicitThis) {
            const thisEntry = this.currentScope.find("this");
            if (thisEntry && this.currentFunction) {
                const thisPtr = `%this.ptr`; // Alloca for 'this'
                this.emit(`${thisPtr} = alloca ${thisEntry.llvmType}, align ${this.llvmHelper.getAlign(thisEntry.llvmType)}`);
                this.emit(`store ${thisEntry.llvmType} %this, ${thisEntry.llvmType}* ${thisPtr}, align ${this.llvmHelper.getAlign(thisEntry.llvmType)}`);
                this.currentScope.define("this", { // Overwrite the 'this' in class scope with the alloca'd one for this function
                    llvmType: thisEntry.llvmType,
                    ptr: thisPtr,
                    isPointer: true
                });
            }
        }

        // Now process actual declared parameters, storing them into fresh allocas
        decl.parameters.forEach(p => {
            const paramName = p.name.lexeme;
            const paramType = this.llvmHelper.getLLVMType(p.type);
            const paramPtr = `%p.${paramName}`; // The alloca'd local variable for this parameter
            const incomingArgName = `%${paramName}`; // Use the named parameter from the signature
            
            this.emit(`${paramPtr} = alloca ${paramType}, align ${this.llvmHelper.getAlign(paramType)}`);
            this.emit(`store ${paramType} ${incomingArgName}, ${paramType}* ${paramPtr}, align ${this.llvmHelper.getAlign(paramType)}`);
            
            this.currentScope.define(paramName, {
                llvmType: paramType,
                ptr: paramPtr,
                isPointer: paramType.endsWith('*')
            });
        });


        decl.body.accept(this);
        
        const lastLine = this.builder[this.builder.length - 1];
        if (lastLine !== undefined && !lastLine.trim().startsWith('ret ') && !lastLine.trim().startsWith('br ')) {
             if (llvmReturnType === 'void') { // Use the effective return type for this check
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
        this.sretPointer = null; // Reset sret pointer for next function
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
                isPointer: true
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

        // New case: Dereferencing a pointer from `objof` to a value.
        // e.g., (objof(addr) as int) -> value from `i8*` to `i32`
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
            isPointer: true
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
        this.globalScope.define(originalFuncName, { llvmType: `${funcType}*`, ptr: mangledName, isPointer: true });

        this.emit(`declare ${returnType} ${mangledName}(${paramsString})`, false);
    }

    visitUsingStmt(stmt: UsingStmt): void {
        // For now, `using` declarations don't generate any IR directly.
        // They are primarily for providing type information or linking to external libraries,
        // which would be handled in the semantic analysis or linker stages.
    }
}
