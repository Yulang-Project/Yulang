import { Token } from './token.js';
export interface ExprVisitor<R> {
    visitLiteralExpr(expr: LiteralExpr): R;
    visitBinaryExpr(expr: BinaryExpr): R;
    visitUnaryExpr(expr: UnaryExpr): R;
    visitIdentifierExpr(expr: IdentifierExpr): R;
    visitGroupingExpr(expr: GroupingExpr): R;
    visitCallExpr(expr: CallExpr): R;
    visitGetExpr(expr: GetExpr): R;
    visitIndexExpr(expr: IndexExpr): R;
    visitAssignExpr(expr: AssignExpr): R;
    visitThisExpr(expr: ThisExpr): R;
    visitAsExpr(expr: AsExpr): R;
    visitObjectLiteralExpr(expr: ObjectLiteralExpr): R;
    visitNewExpr(expr: NewExpr): R;
    visitDeleteExpr(expr: DeleteExpr): R;
    visitAddressOfExpr(expr: AddressOfExpr): R;
    visitDereferenceExpr(expr: DereferenceExpr): R;
    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): R;
    visitArrayLiteralExpr(expr: ArrayLiteralExpr): R;
}
export interface StmtVisitor<R> {
    visitExpressionStmt(stmt: ExpressionStmt): R;
    visitBlockStmt(stmt: BlockStmt): R;
    visitLetStmt(stmt: LetStmt): R;
    visitConstStmt(stmt: ConstStmt): R;
    visitIfStmt(stmt: IfStmt): R;
    visitWhileStmt(stmt: WhileStmt): R;
    visitReturnStmt(stmt: ReturnStmt): R;
    visitFunctionDeclaration(decl: FunctionDeclaration): R;
    visitClassDeclaration(decl: ClassDeclaration): R;
    visitStructDeclaration(decl: StructDeclaration): R;
    visitPropertyDeclaration(stmt: PropertyDeclaration): R;
    visitImportStmt(stmt: ImportStmt): R;
    visitDeclareFunction(decl: DeclareFunction): R;
    visitUsingStmt(stmt: UsingStmt): R;
}
export declare abstract class ASTNode {
    abstract accept<R>(visitor: any): R;
}
export declare abstract class Expr extends ASTNode {
    abstract accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class LiteralExpr extends Expr {
    value: any;
    constructor(value: any);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class BinaryExpr extends Expr {
    left: Expr;
    operator: Token;
    right: Expr;
    constructor(left: Expr, operator: Token, right: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class UnaryExpr extends Expr {
    operator: Token;
    right: Expr;
    constructor(operator: Token, right: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class AddressOfExpr extends Expr {
    expression: Expr;
    constructor(expression: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class DereferenceExpr extends Expr {
    expression: Expr;
    constructor(expression: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class IdentifierExpr extends Expr {
    name: Token;
    constructor(name: Token);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class GroupingExpr extends Expr {
    expression: Expr;
    constructor(expression: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class CallExpr extends Expr {
    callee: Expr;
    paren: Token;
    args: Expr[];
    constructor(callee: Expr, paren: Token, args: Expr[]);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class GetExpr extends Expr {
    object: Expr;
    name: Token;
    constructor(object: Expr, name: Token);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class IndexExpr extends Expr {
    array: Expr;
    index: Expr;
    constructor(array: Expr, index: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class AssignExpr extends Expr {
    target: Expr;
    value: Expr;
    constructor(target: Expr, value: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class ThisExpr extends Expr {
    keyword: Token;
    constructor(keyword: Token);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class AsExpr extends Expr {
    expression: Expr;
    type: TypeAnnotation;
    constructor(expression: Expr, type: TypeAnnotation);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class ObjectLiteralExpr extends Expr {
    properties: Map<Token, Expr>;
    constructor(properties: Map<Token, Expr>);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class NewExpr extends Expr {
    callee: Expr;
    args: Expr[];
    constructor(callee: Expr, args: Expr[]);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class DeleteExpr extends Expr {
    target: Expr;
    constructor(target: Expr);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class FunctionLiteralExpr extends Expr {
    parameters: Parameter[];
    returnType: TypeAnnotation | null;
    body: BlockStmt;
    constructor(parameters: Parameter[], returnType: TypeAnnotation | null, body: BlockStmt);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare class ArrayLiteralExpr extends Expr {
    elements: Expr[];
    constructor(elements: Expr[]);
    accept<R>(visitor: ExprVisitor<R>): R;
}
export declare abstract class Stmt extends ASTNode {
    abstract accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class ExpressionStmt extends Stmt {
    expression: Expr;
    constructor(expression: Expr);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class BlockStmt extends Stmt {
    statements: Stmt[];
    constructor(statements: Stmt[]);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare abstract class TypeAnnotation extends ASTNode {
    abstract accept<R>(visitor: TypeAnnotationVisitor<R>): R;
}
export interface TypeAnnotationVisitor<R> {
    visitBasicTypeAnnotation(type: BasicTypeAnnotation): R;
    visitArrayTypeAnnotation(type: ArrayTypeAnnotation): R;
    visitPointerTypeAnnotation(type: PointerTypeAnnotation): R;
    visitFunctionTypeAnnotation(type: FunctionTypeAnnotation): R;
}
export declare class BasicTypeAnnotation extends TypeAnnotation {
    name: Token;
    constructor(name: Token);
    accept<R>(visitor: TypeAnnotationVisitor<R>): R;
}
export declare class ArrayTypeAnnotation extends TypeAnnotation {
    elementType: TypeAnnotation;
    constructor(elementType: TypeAnnotation);
    accept<R>(visitor: TypeAnnotationVisitor<R>): R;
}
export declare class PointerTypeAnnotation extends TypeAnnotation {
    baseType: TypeAnnotation;
    constructor(baseType: TypeAnnotation);
    accept<R>(visitor: TypeAnnotationVisitor<R>): R;
}
export declare class FunctionTypeAnnotation extends TypeAnnotation {
    parameters: TypeAnnotation[];
    returnType: TypeAnnotation;
    constructor(parameters: TypeAnnotation[], returnType: TypeAnnotation);
    accept<R>(visitor: TypeAnnotationVisitor<R>): R;
}
export declare class LetStmt extends Stmt {
    name: Token;
    type: TypeAnnotation | null;
    initializer: Expr | null;
    isExported: boolean;
    constructor(name: Token, type: TypeAnnotation | null, initializer: Expr | null, isExported?: boolean);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class ConstStmt extends Stmt {
    name: Token;
    type: TypeAnnotation | null;
    initializer: Expr | null;
    isExported: boolean;
    constructor(name: Token, type: TypeAnnotation | null, initializer: Expr | null, isExported?: boolean);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class IfStmt extends Stmt {
    condition: Expr;
    thenBranch: Stmt;
    elseBranch: Stmt | null;
    constructor(condition: Expr, thenBranch: Stmt, elseBranch: Stmt | null);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class WhileStmt extends Stmt {
    condition: Expr;
    body: Stmt;
    constructor(condition: Expr, body: Stmt);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class ReturnStmt extends Stmt {
    keyword: Token;
    value: Expr | null;
    constructor(keyword: Token, value: Expr | null);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class Parameter extends ASTNode {
    name: Token;
    type: TypeAnnotation | null;
    constructor(name: Token, type: TypeAnnotation | null);
    accept<R>(visitor: any): R;
}
export declare class FunctionDeclaration extends Stmt {
    name: Token;
    parameters: Parameter[];
    returnType: TypeAnnotation | null;
    body: BlockStmt;
    isExported: boolean;
    visibility: Token;
    capturedVariables: any[] | null;
    isStatic: boolean;
    constructor(name: Token, parameters: Parameter[], returnType: TypeAnnotation | null, body: BlockStmt, isExported: boolean | undefined, visibility: Token, // Add visibility field
    capturedVariables?: any[] | null, isStatic?: boolean);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class PropertyDeclaration extends Stmt {
    visibility: Token;
    name: Token;
    type: TypeAnnotation | null;
    initializer: Expr | null;
    constructor(visibility: Token, name: Token, type: TypeAnnotation | null, initializer: Expr | null);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class DeclareFunction extends Stmt {
    name: Token;
    parameters: Parameter[];
    returnType: TypeAnnotation | null;
    constructor(name: Token, parameters: Parameter[], returnType: TypeAnnotation | null);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class ClassDeclaration extends Stmt {
    name: Token;
    properties: PropertyDeclaration[];
    methods: FunctionDeclaration[];
    isExported: boolean;
    isDeclare: boolean;
    constructor(name: Token, properties: PropertyDeclaration[], methods: FunctionDeclaration[], isExported?: boolean, isDeclare?: boolean);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class StructDeclaration extends Stmt {
    name: Token;
    properties: PropertyDeclaration[];
    isExported: boolean;
    isDeclare: boolean;
    constructor(name: Token, properties: PropertyDeclaration[], isExported?: boolean, isDeclare?: boolean);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class ImportStmt extends Stmt {
    sourcePath: Token;
    namespaceAlias: Token | null;
    isDeclare: boolean;
    constructor(sourcePath: Token, // 导入的模块路径，例如 "modulePath"
    namespaceAlias: Token | null, // 命名空间别名，例如 `identifier` (for `import identifier from ...`)
    isDeclare?: boolean);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export declare class UsingStmt extends Stmt {
    path: Token;
    alias: Token | null;
    isDeclare: boolean;
    constructor(path: Token, alias: Token | null, isDeclare?: boolean);
    accept<R>(visitor: StmtVisitor<R>): R;
}
export interface AstVisitor<R> extends ExprVisitor<R>, StmtVisitor<R> {
}
export declare class AstPrinter implements ExprVisitor<string>, StmtVisitor<string> {
    print(node: ASTNode | null): string;
    visitLiteralExpr(expr: LiteralExpr): string;
    visitIdentifierExpr(expr: IdentifierExpr): string;
    visitUnaryExpr(expr: UnaryExpr): string;
    visitBinaryExpr(expr: BinaryExpr): string;
    visitGroupingExpr(expr: GroupingExpr): string;
    visitCallExpr(expr: CallExpr): string;
    visitGetExpr(expr: GetExpr): string;
    visitIndexExpr(expr: IndexExpr): string;
    visitAssignExpr(expr: AssignExpr): string;
    visitThisExpr(expr: ThisExpr): string;
    visitAsExpr(expr: AsExpr): string;
    visitObjectLiteralExpr(expr: ObjectLiteralExpr): string;
    visitNewExpr(expr: NewExpr): string;
    visitDeleteExpr(expr: DeleteExpr): string;
    visitAddressOfExpr(expr: AddressOfExpr): string;
    visitDereferenceExpr(expr: DereferenceExpr): string;
    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): string;
    visitArrayLiteralExpr(expr: ArrayLiteralExpr): string;
    visitExpressionStmt(stmt: ExpressionStmt): string;
    visitLetStmt(stmt: LetStmt): string;
    visitConstStmt(stmt: ConstStmt): string;
    visitBlockStmt(stmt: BlockStmt): string;
    visitIfStmt(stmt: IfStmt): string;
    visitWhileStmt(stmt: WhileStmt): string;
    visitReturnStmt(stmt: ReturnStmt): string;
    visitFunctionDeclaration(decl: FunctionDeclaration): string;
    visitClassDeclaration(stmt: ClassDeclaration): string;
    visitStructDeclaration(decl: StructDeclaration): string;
    visitPropertyDeclaration(stmt: PropertyDeclaration): string;
    visitImportStmt(stmt: ImportStmt): string;
    visitDeclareFunction(decl: DeclareFunction): string;
    visitUsingStmt(stmt: UsingStmt): string;
    visitBasicTypeAnnotation(type: BasicTypeAnnotation): string;
    visitArrayTypeAnnotation(type: ArrayTypeAnnotation): string;
    visitPointerTypeAnnotation(type: PointerTypeAnnotation): string;
    visitFunctionTypeAnnotation(type: FunctionTypeAnnotation): string;
    printType(type: TypeAnnotation): string;
    private parenthesize;
}
//# sourceMappingURL=ast.d.ts.map