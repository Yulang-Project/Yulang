// src/generator/irgen/types_scopes.ts

import type {
    ASTNode, ExprVisitor, StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, AssignExpr, ThisExpr, AsExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, AddressOfExpr, DereferenceExpr, FunctionLiteralExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction, MacroBlockStmt,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, UsingStmt, PointerTypeAnnotation, FunctionTypeAnnotation
} from '../../ast.js';
import { Token, TokenType } from '../../token.js';

/**
 * 表示一个 LLVM IR 值，包含其值字符串、类型，以及可选的类实例指针、类型、通用指针和地址。
 */
export type IRValue = {
    value: string;
    type: string;
    classInstancePtr?: string;
    classInstancePtrType?: string;
    ptr?: string; // 如果值是变量的指针，这里存储其 alloca/global ptr
    ptrType?: string; // 对应 ptr 的类型
    address?: string; // 如果值是从内存中加载的，这里存储加载的源地址
};

/**
 * 符号表中的条目。
 */
export type SymbolEntry = {
    llvmType: string; // 变量的 LLVM 类型 (例如, i32, i8*, %struct.MyClass*)
    ptr: string;      // LLVM IR 中指向变量值存储位置的指针名称 (例如, %var_ptr)
    isPointer: boolean; // 如果这个 Yulang 变量本身是一个指针类型 (例如, `let p: pointer(char)`)，则为 true
    definedInScopeDepth: number; // 变量定义的深度，用于闭包捕获分析
};

/**
 * 表示一个作用域（例如，函数体、if 块）。
 */
export class Scope {
    private symbols: Map<string, SymbolEntry> = new Map();
    constructor(public parent: Scope | null = null, public depth: number = 0) { }

    /**
     * 在当前作用域中定义一个新符号。
     * @param name 符号名称。
     * @param entry 符号条目。
     * @returns 如果成功定义，则为 true；如果名称已存在于当前作用域，则为 false。
     */
    define(name: string, entry: SymbolEntry): boolean {
        if (this.symbols.has(name)) {
            return false; // 变量已在此作用域中定义
        }
        this.symbols.set(name, entry);
        return true;
    }

    /**
     * 在当前作用域或其父作用域中查找符号。
     * @param name 符号名称。
     * @returns 找到的符号条目，如果未找到则为 null。
     */
    find(name: string): SymbolEntry | null {
        return this.symbols.get(name) || this.parent?.find(name) || null;
    }
}

/**
 * 捕获变量的信息。
 */
export class CapturedVariableInfo {
    constructor(
        public name: string,
        public llvmType: string, // 变量本身的类型 (例如, i32, %struct.MyStruct, i32*)
        public ptr: string,      // 指向该变量存储位置的 alloca/global ptr
        public definedInScopeDepth: number
    ) { }
}

/**
 * 辅助访问者，用于在函数体中查找捕获的变量。
 */
export class ClosureAnalyzer implements ExprVisitor<void>, StmtVisitor<void> {
    private captured: Map<string, CapturedVariableInfo> = new Map();
    private outerScopeAtLiteralDefinition: Scope; // 闭包字面量定义时的外部作用域
    private functionBodyScopeDepth: number; // 闭包函数体将创建的作用域的深度

    constructor(outerScopeAtLiteralDefinition: Scope, functionBodyScopeDepth: number) {
        this.outerScopeAtLiteralDefinition = outerScopeAtLiteralDefinition;
        this.functionBodyScopeDepth = functionBodyScopeDepth;
    }

    /**
     * 获取捕获的变量列表。
     * @returns 捕获变量的数组。
     */
    getCapturedVariables(): CapturedVariableInfo[] {
        return Array.from(this.captured.values());
    }

    /**
     * 解析标识符并在必要时捕获。
     * @param name 标识符名称。
     */
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
    visitLiteralExpr(expr: LiteralExpr): void { }
    visitBinaryExpr(expr: BinaryExpr): void { expr.left.accept(this); expr.right.accept(this); }
    visitUnaryExpr(expr: UnaryExpr): void { expr.right.accept(this); }
    visitAddressOfExpr(expr: AddressOfExpr): void { expr.expression.accept(this); }
    visitDereferenceExpr(expr: DereferenceExpr): void { expr.expression.accept(this); }
    visitGroupingExpr(expr: GroupingExpr): void { expr.expression.accept(this); }
    visitCallExpr(expr: CallExpr): void { expr.callee.accept(this); expr.args.forEach(arg => arg.accept(this)); }
    visitGetExpr(expr: GetExpr): void { expr.object.accept(this); }
    visitAssignExpr(expr: AssignExpr): void { expr.target.accept(this); expr.value.accept(this); }
    visitThisExpr(expr: ThisExpr): void { }
    visitAsExpr(expr: AsExpr): void { expr.expression.accept(this); }
    visitObjectLiteralExpr(expr: ObjectLiteralExpr): void { expr.properties.forEach(v => v.accept(this)); }
    visitNewExpr(expr: NewExpr): void { expr.callee.accept(this); expr.args.forEach(arg => arg.accept(this)); }
    visitDeleteExpr(expr: DeleteExpr): void { expr.target.accept(this); }
    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): void { }

    visitIdentifierExpr(expr: IdentifierExpr): void {
        this.resolveIdentifierAndCaptureIfNecessary(expr.name.lexeme);
    }

    // --- StmtVisitor ---
    visitExpressionStmt(stmt: ExpressionStmt): void { stmt.expression.accept(this); }
    visitBlockStmt(stmt: BlockStmt): void { stmt.statements.forEach(s => s.accept(this)); }
    visitLetStmt(stmt: LetStmt): void {
        if (stmt.initializer) stmt.initializer.accept(this);
    }
    visitConstStmt(stmt: ConstStmt): void {
        if (stmt.initializer) stmt.initializer.accept(this);
    }
    visitIfStmt(stmt: IfStmt): void {
        stmt.condition.accept(this);
        stmt.thenBranch.accept(this);
        if (stmt.elseBranch) stmt.elseBranch.accept(this);
    }
    visitWhileStmt(stmt: WhileStmt): void { stmt.condition.accept(this); stmt.body.accept(this); }
    visitReturnStmt(stmt: ReturnStmt): void { if (stmt.value) stmt.value.accept(this); }
    visitFunctionDeclaration(decl: FunctionDeclaration): void { }
    visitClassDeclaration(decl: ClassDeclaration): void { }
    visitStructDeclaration(decl: StructDeclaration): void { }
    visitPropertyDeclaration(stmt: PropertyDeclaration): void { if (stmt.initializer) stmt.initializer.accept(this); }
    visitImportStmt(stmt: ImportStmt): void { }
    visitDeclareFunction(decl: DeclareFunction): void { }
    visitUsingStmt(stmt: UsingStmt): void { }
    visitMacroBlockStmt(stmt: MacroBlockStmt): void { }
}

/**
 * 类或结构体成员的条目。
 */
export type MemberEntry = {
    llvmType: string;
    index: number;
};

/**
 * 类定义条目。
 */
export type ClassEntry = {
    llvmType: string; // 例如, %struct.MyClass
    members: Map<string, MemberEntry>;
    methods: Map<string, FunctionDeclaration>; // 存储方法声明
};

/**
 * 模块成员条目。
 */
export type ModuleMember = {
    llvmType: string;
    index: number;
    ptr: string;
};