// src/generator/irgen/ir_generator_base.ts

import type { ASTNode, Stmt, LiteralExpr, BinaryExpr, UnaryExpr, GroupingExpr, AddressOfExpr, DereferenceExpr, IdentifierExpr, AssignExpr, GetExpr, CallExpr, FunctionLiteralExpr, NewExpr, DeleteExpr, ObjectLiteralExpr, ThisExpr, AsExpr, ExpressionStmt, BlockStmt, IfStmt, WhileStmt, ReturnStmt, PropertyDeclaration, UsingStmt, MacroBlockStmt } from '../../ast.js'; // These are used as types in the interfaces
import { FunctionDeclaration, LetStmt, ConstStmt, ImportStmt, DeclareFunction, ClassDeclaration, StructDeclaration } from '../../ast.js'; // These are used as values in instanceof checks
import { TokenType } from '../../token.js';
import { LLVMIRHelper } from '../llvm_ir_helpers.js';
import { Parser } from '../../parser/index.js';
import * as path from 'path';
import * as process from 'process';
import { BuiltinFunctions } from '../builtins.js';
import { LangItems } from '../lang_items.js';
import type { IPlatform } from '../../platform/IPlatform.js';
import * as irgen_utils from './ir_generator_utils.js';
import { buildModuleObject } from './module_handling.js';
import type {
    IRValue,
    SymbolEntry,
    ClassEntry,
    ModuleMember
} from './types_scopes.js';
import {
    Scope
} from './types_scopes.js';
import type { ExprVisitor, StmtVisitor } from '../../ast.js';
import {
    visitAddressOfExpr, visitDereferenceExpr, visitIdentifierExpr, visitAssignExpr, visitGetExpr
} from './expr_variables.js';
import {
    visitCallExpr
} from './expr_functions.js';
import {
    visitFunctionLiteralExpr
} from './expr_function_literal.js';
import {
    visitNewExpr, visitDeleteExpr, visitObjectLiteralExpr, visitThisExpr, visitAsExpr
} from './expr_objects.js';
import {
    visitLiteralExpr, visitBinaryExpr, visitUnaryExpr, visitGroupingExpr
} from './expr_simple.js';
import {
    visitExpressionStmt, visitBlockStmt, visitIfStmt, visitWhileStmt, visitReturnStmt, visitMacroBlockStmt
} from './stmt_control_flow.js';
import {
    visitLetStmt, visitConstStmt, visitGlobalLetStmt, visitLocalLetStmt
} from './stmt_declarations.js';
import {
    visitFunctionDeclaration, declareFunctionSymbol, emitFunctionDefinition, visitDeclareFunction
} from './stmt_functions.js';
import {
    visitClassDeclaration, visitStructDeclaration, visitPropertyDeclaration
} from './stmt_types.js';
import {
    visitImportStmt, visitUsingStmt
} from './stmt_modules.js';

/**
 * LLVM IR 生成器。
 * 遍历 AST，生成 LLVM IR。
 */
export class IRGenerator implements ExprVisitor<IRValue>, StmtVisitor<void> {
    public builder: string[] = [];
    public indentLevel: number = 0;
    public llvmHelper: LLVMIRHelper = new LLVMIRHelper();
    public builtins: BuiltinFunctions;

    public globalScope: Scope = new Scope(null, 0);
    public currentScope: Scope = this.globalScope;
    public inMacroBlock: boolean = false;
    public macroBlockType: TokenType | null = null;
    public currentFunction: FunctionDeclaration | null = null;
    public labelCounter = 0;
    public classDefinitions: Map<string, ClassEntry> = new Map();
    public declaredSymbols: Set<string> = new Set();
    public generatedFunctions: Set<string> = new Set();
    public sretPointer: string | null = null;
    public parser: Parser;
    public mangleStdLib: boolean;
    public sourceFilePath: string;
    public debug: boolean;
    public pass: 'declaration' | 'definition' = 'declaration';
    public objectLiteralCounter: number = 0;
    public objectLiteralExpectedStructType: string | null = null;
    public heapGlobalsEmitted: boolean = false;
    public lowLevelRuntimeEmitted: boolean = false;
    public moduleObjects: Map<string, { structName: string, globalName: string, members: Map<string, ModuleMember>, initialized: boolean }> = new Map();
    public hoistedDefinitions: string[] = [];
    public hoistedFunctions: string[][] = [];
    public platform: IPlatform;
    public emittedArrayStructs: Set<string> = new Set();

    /**
     * 构造函数。
     * @param platform 平台接口。
     * @param parser 解析器实例。
     * @param mangleStdLib 是否混淆标准库符号。
     * @param sourceFilePath 源文件路径。
     * @param debug 是否开启调试模式。
     */
    constructor(platform: IPlatform, parser: Parser, mangleStdLib: boolean = true, sourceFilePath: string = '', debug: boolean = false) {
        this.platform = platform;
        this.parser = parser;
        this.mangleStdLib = mangleStdLib;
        this.sourceFilePath = sourceFilePath;
        this.debug = debug;
        this.builtins = new BuiltinFunctions(this.llvmHelper);
        this.llvmHelper.setGenerator(this as any); // 设置反向引用，绕过循环依赖的类型问题
        this.emit(`target triple = "${this.platform.getTargetTriple()}"`, false);
        this.emit(`target datalayout = "${this.platform.getDataLayout()}"`, false);
        irgen_utils.emitLangItemStructs(this);
        this.builtins.createPanicOOB();
        irgen_utils.emitLowLevelRuntime(this);
        irgen_utils.emitHeapGlobals(this);
        this.emit("", false);
    }

    /**
     * 根据 AST 节点生成 LLVM IR。
     * @param nodes AST 节点数组。
     * @returns 生成的 LLVM IR 字符串。
     */
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

        // 在第一个函数定义之前插入提升的定义（例如，闭包环境结构或嵌套函数）
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

        // 添加所有累积的全局字符串定义
        this.llvmHelper.getGlobalStrings().forEach(def => {
            if (!this.builder.includes(def)) {
                this.builder.push(def);
            }
        });

        return this.builder.join('\n');
    }

    /**
     * 发出全局定义。
     * @param nodes AST 节点数组。
     */
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
                declareFunctionSymbol(this, fn);
                this.declaredSymbols.add(key);
            }
        });

        // 第三遍：发出函数定义
        functions.forEach(fn => {
            const key = this.getFunctionKey(fn);
            if (!this.generatedFunctions.has(key)) {
                emitFunctionDefinition(this, fn);
                this.generatedFunctions.add(key);
            }
        });
        this.builder.push("");
    }

    /**
     * 进入新的作用域。
     */
    public enterScope(): void {
        this.currentScope = new Scope(this.currentScope, this.currentScope.depth + 1);
    }

    /**
     * 退出当前作用域。
     */
    public exitScope(): void {
        if (this.currentScope.parent) {
            this.currentScope = this.currentScope.parent;
        }
    }

    /**
     * 获取一个新的唯一标签。
     * @param prefix 标签前缀。
     * @returns 唯一标签字符串。
     */
    public getNewLabel(prefix: string): string {
        return `${prefix}.${this.labelCounter++}`;
    }

    /**
     * 发出 LLVM IR 代码。
     * @param ir 要发出的 IR 字符串。
     * @param indent 是否缩进。
     */
    public emit(ir: string, indent: boolean = true): void {
        if (ir === null || ir === undefined) return;
        const indentation = indent ? '  '.repeat(this.indentLevel) : '';
        this.builder.push(`${indentation}${ir}`);
    }

    /**
     * 获取全局符号。
     * @param name 符号名称。
     * @returns 符号条目，如果未找到则为 null。
     */
    public getGlobalSymbol(name: string): SymbolEntry | null {
        return this.globalScope.find(name);
    }

    /**
     * 获取函数键。
     * @param decl 函数声明。
     * @returns 函数的唯一键。
     */
    public getFunctionKey(decl: FunctionDeclaration): string {
        return `${this.sourceFilePath}:${decl.name.lexeme}`;
    }

    /**
     * 将 LLVM 结构体类型字符串拆分为其顶级字段。
     * @param structType 结构体类型字符串。
     * @returns 字段类型数组。
     */
    public splitStructFields(structType: string): string[] {
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

    /**
     * 发出提升的定义。
     * @param def 定义字符串。
     */
    public emitHoisted(def: string) {
        if (!this.hoistedDefinitions.includes(def)) {
            this.hoistedDefinitions.push(def);
        }
    }

    /**
     * 提升函数定义。
     * @param lines 函数定义行数组。
     */
    public hoistFunctionDefinition(lines: string[]) {
        if (lines.length > 0) this.hoistedFunctions.push(lines);
    }

    // ExprVisitor methods
    public visitLiteralExpr(expr: LiteralExpr): IRValue { return visitLiteralExpr(this, expr); }
    public visitBinaryExpr(expr: BinaryExpr): IRValue { return visitBinaryExpr(this, expr); }
    public visitUnaryExpr(expr: UnaryExpr): IRValue { return visitUnaryExpr(this, expr); }
    public visitGroupingExpr(expr: GroupingExpr): IRValue { return visitGroupingExpr(this, expr); }
    public visitAddressOfExpr(expr: AddressOfExpr): IRValue { return visitAddressOfExpr(this, expr); }
    public visitDereferenceExpr(expr: DereferenceExpr): IRValue { return visitDereferenceExpr(this, expr); }
    public visitIdentifierExpr(expr: IdentifierExpr): IRValue { return visitIdentifierExpr(this, expr); }
    public visitAssignExpr(expr: AssignExpr): IRValue { return visitAssignExpr(this, expr); }
    public visitGetExpr(expr: GetExpr): IRValue { return visitGetExpr(this, expr); }
    public visitCallExpr(expr: CallExpr): IRValue { return visitCallExpr(this, expr); }
    public visitFunctionLiteralExpr(expr: FunctionLiteralExpr): IRValue { return visitFunctionLiteralExpr(this, expr); }
    public visitNewExpr(expr: NewExpr): IRValue { return visitNewExpr(this, expr); }
    public visitDeleteExpr(expr: DeleteExpr): IRValue { return visitDeleteExpr(this, expr); }
    public visitObjectLiteralExpr(expr: ObjectLiteralExpr): IRValue { return visitObjectLiteralExpr(this, expr); }
    public visitThisExpr(expr: ThisExpr): IRValue { return visitThisExpr(this, expr); }
    public visitAsExpr(expr: AsExpr): IRValue { return visitAsExpr(this, expr); }

    // StmtVisitor methods
    public visitExpressionStmt(stmt: ExpressionStmt): void { visitExpressionStmt(this, stmt); }
    public visitBlockStmt(stmt: BlockStmt): void { visitBlockStmt(this, stmt); }
    public visitLetStmt(stmt: LetStmt): void { visitLetStmt(this, stmt); }
    public visitConstStmt(stmt: ConstStmt): void { visitConstStmt(this, stmt); }
    public visitIfStmt(stmt: IfStmt): void { visitIfStmt(this, stmt); }
    public visitWhileStmt(stmt: WhileStmt): void { visitWhileStmt(this, stmt); }
    public visitReturnStmt(stmt: ReturnStmt): void { visitReturnStmt(this, stmt); }
    public visitFunctionDeclaration(decl: FunctionDeclaration): void { visitFunctionDeclaration(this, decl); }
    public visitClassDeclaration(decl: ClassDeclaration): void { visitClassDeclaration(this, decl); }
    public visitStructDeclaration(decl: StructDeclaration): void { visitStructDeclaration(this, decl); }
    public visitPropertyDeclaration(stmt: PropertyDeclaration): void { visitPropertyDeclaration(this, stmt); }
    public visitImportStmt(stmt: ImportStmt): void { visitImportStmt(this, stmt); }
    public visitDeclareFunction(decl: DeclareFunction): void { visitDeclareFunction(this, decl); }
    public visitUsingStmt(stmt: UsingStmt): void { visitUsingStmt(this, stmt); }
    public visitMacroBlockStmt(stmt: MacroBlockStmt): void { visitMacroBlockStmt(this, stmt); }
}