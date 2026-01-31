import { Token, TokenType } from './token.js';

// --- Visitor Interfaces ---
export interface ExprVisitor<R> {
    visitLiteralExpr(expr: LiteralExpr): R;
    visitBinaryExpr(expr: BinaryExpr): R;
    visitUnaryExpr(expr: UnaryExpr): R;
    visitIdentifierExpr(expr: IdentifierExpr): R;
    visitGroupingExpr(expr: GroupingExpr): R;
    visitCallExpr(expr: CallExpr): R;
    visitGetExpr(expr: GetExpr): R;
    visitAssignExpr(expr: AssignExpr): R;
    visitThisExpr(expr: ThisExpr): R;
    visitAsExpr(expr: AsExpr): R; // NEW
    visitObjectLiteralExpr(expr: ObjectLiteralExpr): R; // NEW
    visitNewExpr(expr: NewExpr): R; // NEW
    visitDeleteExpr(expr: DeleteExpr): R; // NEW
    visitAddressOfExpr(expr: AddressOfExpr): R;
    visitDereferenceExpr(expr: DereferenceExpr): R;
    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): R;
}

export interface StmtVisitor<R> {
    visitExpressionStmt(stmt: ExpressionStmt): R;
    visitBlockStmt(stmt: BlockStmt): R;
    visitLetStmt(stmt: LetStmt): R;
    visitConstStmt(stmt: ConstStmt): R; // NEW: Visit ConstStmt
    visitIfStmt(stmt: IfStmt): R;
    visitWhileStmt(stmt: WhileStmt): R;
    visitReturnStmt(stmt: ReturnStmt): R;
    visitFunctionDeclaration(decl: FunctionDeclaration): R;
    visitClassDeclaration(decl: ClassDeclaration): R;
    visitStructDeclaration(decl: StructDeclaration): R; // NEW
    visitPropertyDeclaration(stmt: PropertyDeclaration): R;
    visitImportStmt(stmt: ImportStmt): R;
    visitDeclareFunction(decl: DeclareFunction): R;
    visitUsingStmt(stmt: UsingStmt): R; // ADDED: visitUsingStmt
    visitMacroBlockStmt(stmt: MacroBlockStmt): R; // NEW: Visit MacroBlockStmt
}

// Base classes need a generic accept method for nodes that might be used in multiple contexts (like TypeAnnotation)
// However, for Stmt and Expr, we'll specialize them.
export abstract class ASTNode {
    // A generic accept for nodes that don't fit neatly into Expr/Stmt
    abstract accept<R>(visitor: any): R;
}

// --- Expressions ---
export abstract class Expr extends ASTNode {
    abstract accept<R>(visitor: ExprVisitor<R>): R;
}

export class LiteralExpr extends Expr {
    constructor(public value: any) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitLiteralExpr(this); }
}

export class BinaryExpr extends Expr {
    constructor(public left: Expr, public operator: Token, public right: Expr) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitBinaryExpr(this); }
}

export class UnaryExpr extends Expr {
    constructor(public operator: Token, public right: Expr) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitUnaryExpr(this); }
}

export class AddressOfExpr extends Expr {
    constructor(public expression: Expr) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitAddressOfExpr(this); }
}

export class DereferenceExpr extends Expr {
    constructor(public expression: Expr) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitDereferenceExpr(this); }
}

export class IdentifierExpr extends Expr {
    constructor(public name: Token) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitIdentifierExpr(this); }
}

export class GroupingExpr extends Expr {
    constructor(public expression: Expr) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitGroupingExpr(this); }
}

export class CallExpr extends Expr {
    constructor(public callee: Expr, public paren: Token, public args: Expr[]) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitCallExpr(this); }
}

export class GetExpr extends Expr {
    constructor(public object: Expr, public name: Token) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitGetExpr(this); }
}

export class AssignExpr extends Expr {
    constructor(public target: Expr, public value: Expr) { super(); } // Changed name:Token to target:Expr
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitAssignExpr(this); }
}

export class ThisExpr extends Expr {
    constructor(public keyword: Token) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitThisExpr(this); }
}

// NEW: AsExpr for type casting
export class AsExpr extends Expr {
    constructor(public expression: Expr, public type: TypeAnnotation) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitAsExpr(this); }
}

// NEW: ObjectLiteralExpr for { key: value }
export class ObjectLiteralExpr extends Expr {
    constructor(public properties: Map<Token, Expr>) { super(); } // Using Map for properties
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitObjectLiteralExpr(this); }
}

// NEW: new Class(...) expression
export class NewExpr extends Expr {
    constructor(public callee: Expr, public args: Expr[]) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitNewExpr(this); }
}

// NEW: delete expr
export class DeleteExpr extends Expr {
    constructor(public target: Expr) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitDeleteExpr(this); }
}

export class FunctionLiteralExpr extends Expr {
    constructor(
        public parameters: Parameter[],
        public returnType: TypeAnnotation | null,
        public body: BlockStmt
    ) { super(); }
    accept<R>(visitor: ExprVisitor<R>): R { return visitor.visitFunctionLiteralExpr(this); }
}

// --- Statements ---
export abstract class Stmt extends ASTNode {
    abstract accept<R>(visitor: StmtVisitor<R>): R;
}

export class ExpressionStmt extends Stmt {
    constructor(public expression: Expr) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitExpressionStmt(this); }
}

export class BlockStmt extends Stmt {
    constructor(public statements: Stmt[]) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitBlockStmt(this); }
}

export abstract class TypeAnnotation extends ASTNode {
    // Type annotations are not expressions or statements, visited via a generic visitor
    abstract accept<R>(visitor: TypeAnnotationVisitor<R>): R;
}

// New TypeAnnotation Visitor
export interface TypeAnnotationVisitor<R> {
    visitBasicTypeAnnotation(type: BasicTypeAnnotation): R;
    visitArrayTypeAnnotation(type: ArrayTypeAnnotation): R; // NEW
    visitPointerTypeAnnotation(type: PointerTypeAnnotation): R;
    visitFunctionTypeAnnotation(type: FunctionTypeAnnotation): R;
}

export class BasicTypeAnnotation extends TypeAnnotation {
    constructor(public name: Token) { super(); }
    accept<R>(visitor: TypeAnnotationVisitor<R>): R { return visitor.visitBasicTypeAnnotation(this); }
}

// NEW: ArrayTypeAnnotation
export class ArrayTypeAnnotation extends TypeAnnotation {
    constructor(public elementType: TypeAnnotation) { super(); }
    accept<R>(visitor: TypeAnnotationVisitor<R>): R {
        return visitor.visitArrayTypeAnnotation(this);
    }
}

export class PointerTypeAnnotation extends TypeAnnotation {
    constructor(public baseType: TypeAnnotation) { super(); }
    accept<R>(visitor: TypeAnnotationVisitor<R>): R { return visitor.visitPointerTypeAnnotation(this); }
}

export class FunctionTypeAnnotation extends TypeAnnotation {
    constructor(public parameters: TypeAnnotation[], public returnType: TypeAnnotation) { super(); }
    accept<R>(visitor: TypeAnnotationVisitor<R>): R { return visitor.visitFunctionTypeAnnotation(this); }
}
export class LetStmt extends Stmt {
    constructor(public name: Token, public type: TypeAnnotation | null, public initializer: Expr | null, public isExported: boolean = false) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitLetStmt(this); }
}

export class ConstStmt extends Stmt { // NEW: ConstStmt
    constructor(public name: Token, public type: TypeAnnotation | null, public initializer: Expr | null, public isExported: boolean = false) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitConstStmt(this); }
}

export class IfStmt extends Stmt {
    constructor(public condition: Expr, public thenBranch: Stmt, public elseBranch: Stmt | null) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitIfStmt(this); }
}

export class WhileStmt extends Stmt {
    constructor(public condition: Expr, public body: Stmt) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitWhileStmt(this); }
}

export class ReturnStmt extends Stmt {
    constructor(public keyword: Token, public value: Expr | null) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitReturnStmt(this); }
}

export class Parameter extends ASTNode {
    constructor(public name: Token, public type: TypeAnnotation | null) { super(); }
    accept<R>(visitor: any): R { throw new Error("Parameters should not be visited directly by a generic visitor. Use a specific visitor for type analysis if needed."); }
}

export class FunctionDeclaration extends Stmt {
    constructor(
        public name: Token,
        public parameters: Parameter[],
        public returnType: TypeAnnotation | null,
        public body: BlockStmt,
        public isExported: boolean = false,
        public visibility: Token, // Add visibility field
        public capturedVariables: any[] | null = null
    ) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitFunctionDeclaration(this); }
}

export class PropertyDeclaration extends Stmt {
    constructor(public visibility: Token, public name: Token, public type: TypeAnnotation | null, public initializer: Expr | null) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitPropertyDeclaration(this); }
}

export class DeclareFunction extends Stmt {
    constructor(
        public name: Token,
        public parameters: Parameter[],
        public returnType: TypeAnnotation | null
    ) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitDeclareFunction(this); }
}

export class ClassDeclaration extends Stmt {
    constructor(
        public name: Token,
        public properties: PropertyDeclaration[],
        public methods: FunctionDeclaration[],
        public isExported: boolean = false,
        public isDeclare: boolean = false
    ) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitClassDeclaration(this); }
}

export class StructDeclaration extends Stmt {
    constructor(
        public name: Token,
        public properties: PropertyDeclaration[],
        public isExported: boolean = false,
        public isDeclare: boolean = false
    ) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitStructDeclaration(this); }
}

export class ImportStmt extends Stmt {
    constructor(
        public sourcePath: Token, // 导入的模块路径，例如 "modulePath"
        public namespaceAlias: Token | null, // 命名空间别名，例如 `identifier` (for `import identifier from ...`)
        public isDeclare: boolean = false
    ) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitImportStmt(this); }
}

export class UsingStmt extends Stmt {
    constructor(public path: Token, public alias: Token | null, public isDeclare: boolean = false) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitUsingStmt(this); } // Need to add visitUsingStmt to StmtVisitor
}

export class MacroBlockStmt extends Stmt {
    constructor(public macroType: Token, public body: BlockStmt) { super(); }
    accept<R>(visitor: StmtVisitor<R>): R { return visitor.visitMacroBlockStmt(this); }
}


// A combined visitor for convenience, e.g. for a printer
export interface AstVisitor<R> extends ExprVisitor<R>, StmtVisitor<R> {}

// --- AST Printer ---
// AstPrinter now needs to handle both visitor types
export class AstPrinter implements ExprVisitor<string>, StmtVisitor<string> {
    print(node: ASTNode | null): string {
        if (node === null) return "(null)";
        // TypeAnnotation nodes now have their own visitor accept method
        if (node instanceof TypeAnnotation) {
            return node.accept(this); // Delegate to TypeAnnotationVisitor
        }
        return node.accept(this);
    }

    visitLiteralExpr(expr: LiteralExpr): string { if (expr.value === null) return "nil"; return String(expr.value); }
    visitIdentifierExpr(expr: IdentifierExpr): string { return expr.name.lexeme; }
    visitUnaryExpr(expr: UnaryExpr): string { return this.parenthesize(expr.operator.lexeme, expr.right); }
    visitBinaryExpr(expr: BinaryExpr): string { return this.parenthesize(expr.operator.lexeme, expr.left, expr.right); }
    visitGroupingExpr(expr: GroupingExpr): string { return this.parenthesize("group", expr.expression); }
    visitCallExpr(expr: CallExpr): string { return this.parenthesize("call " + this.print(expr.callee), ...expr.args); }
    visitGetExpr(expr: GetExpr): string { return this.parenthesize("get " + this.print(expr.object) + "." + expr.name.lexeme); }
    visitAssignExpr(expr: AssignExpr): string { return this.parenthesize("assign " + this.print(expr.target), expr.value); }
    visitThisExpr(expr: ThisExpr): string { return expr.keyword.lexeme; }

    // NEW: AsExpr for type casting
    visitAsExpr(expr: AsExpr): string {
        return this.parenthesize(`as ${this.printType(expr.type)}`, expr.expression);
    }
    
    // NEW: ObjectLiteralExpr for { key: value }
    visitObjectLiteralExpr(expr: ObjectLiteralExpr): string {
        const properties = Array.from(expr.properties.entries())
            .map(([key, value]) => `${key.lexeme}: ${this.print(value)}`)
            .join(", ");
        return this.parenthesize(`object { ${properties} }`);
    }

    visitNewExpr(expr: NewExpr): string {
        const args = expr.args.map(a => this.print(a));
        return this.parenthesize("new " + this.print(expr.callee), ...args);
    }

    visitDeleteExpr(expr: DeleteExpr): string {
        return this.parenthesize("delete", expr.target);
    }

    visitAddressOfExpr(expr: AddressOfExpr): string {
        return this.parenthesize("addrof", expr.expression);
    }

    visitDereferenceExpr(expr: DereferenceExpr): string {
        return this.parenthesize("deref", expr.expression);
    }

    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): string {
        const params = expr.parameters.map(p => {
            const typeStr = p.type ? `: ${this.printType(p.type)}` : '';
            return `${p.name.lexeme}${typeStr}`;
        }).join(" ");
        const returnType = expr.returnType ? `: ${this.printType(expr.returnType)}` : '';
        return this.parenthesize(`fun literal(${params})${returnType}`, expr.body);
    }

    visitExpressionStmt(stmt: ExpressionStmt): string { return this.parenthesize("expr", stmt.expression); }
    visitLetStmt(stmt: LetStmt): string {
        const typeStr = stmt.type ? `: ${this.printType(stmt.type)}` : '';
        if (stmt.initializer === null) { return this.parenthesize(`let ${stmt.name.lexeme}${typeStr}`); }
        return this.parenthesize(`let ${stmt.name.lexeme}${typeStr} =`, stmt.initializer);
    }
    visitConstStmt(stmt: ConstStmt): string { // NEW: visitConstStmt
        const typeStr = stmt.type ? `: ${this.printType(stmt.type)}` : '';
        if (stmt.initializer === null) { return this.parenthesize(`const ${stmt.name.lexeme}${typeStr}`); }
        return this.parenthesize(`const ${stmt.name.lexeme}${typeStr} =`, stmt.initializer);
    }
    visitBlockStmt(stmt: BlockStmt): string { return this.parenthesize("block", ...stmt.statements); }
    visitIfStmt(stmt: IfStmt): string {
        if (stmt.elseBranch) { return this.parenthesize("if", stmt.condition, stmt.thenBranch, stmt.elseBranch); }
        return this.parenthesize("if", stmt.condition, stmt.thenBranch);
    }
    visitWhileStmt(stmt: WhileStmt): string { return this.parenthesize("while", stmt.condition, stmt.body); }
    visitReturnStmt(stmt: ReturnStmt): string {
        if (stmt.value === null) { return `(return)`; }
        return this.parenthesize("return", stmt.value);
    }
    visitFunctionDeclaration(decl: FunctionDeclaration): string {
        const params = decl.parameters.map(p => {
            const typeStr = p.type ? `: ${this.printType(p.type)}` : '';
            return `${p.name.lexeme}${typeStr}`;
        }).join(" ");
        const returnType = decl.returnType ? `: ${this.printType(decl.returnType)}` : '';
        return this.parenthesize(`fun ${decl.name.lexeme}(${params})${returnType}`, decl.body);
    }
    visitClassDeclaration(stmt: ClassDeclaration): string {
        return this.parenthesize(`class ${stmt.name.lexeme}`, ...stmt.properties, ...stmt.methods); // Print methods too
    }
    visitStructDeclaration(decl: StructDeclaration): string { // NEW
        return this.parenthesize(`struct ${decl.name.lexeme}`, ...decl.properties);
    }
    visitPropertyDeclaration(stmt: PropertyDeclaration): string {
        const visibility = stmt.visibility.lexeme;
        const typeStr = stmt.type ? `: ${this.printType(stmt.type)}` : '';
        if (stmt.initializer === null) { return this.parenthesize(`${visibility} ${stmt.name.lexeme}${typeStr}`); }
        return this.parenthesize(`${visibility} ${stmt.name.lexeme}${typeStr} =`, stmt.initializer);
    }
    visitImportStmt(stmt: ImportStmt): string {
        // Updated to use sourcePath and namespaceAlias
        const aliasPart = stmt.namespaceAlias ? ` as ${stmt.namespaceAlias.lexeme}` : '';
        return this.parenthesize(`import ${stmt.sourcePath.literal}${aliasPart}`);
    }
    visitDeclareFunction(decl: DeclareFunction): string {
        const params = decl.parameters.map(p => {
            const typeStr = p.type ? `: ${this.printType(p.type)}` : '';
            return `${p.name.lexeme}${typeStr}`;
        }).join(" ");
        const returnType = decl.returnType ? `: ${this.printType(decl.returnType)}` : '';
        return this.parenthesize(`declare fun ${decl.name.lexeme}(${params})${returnType}`);
    }

    visitUsingStmt(stmt: UsingStmt): string { // ADDED: visitUsingStmt
        const aliasPart = stmt.alias ? ` as ${stmt.alias.lexeme}` : '';
        return this.parenthesize(`using ${stmt.path.literal}${aliasPart}`);
    }

    visitMacroBlockStmt(stmt: MacroBlockStmt): string {
        return this.parenthesize(`macro(${stmt.macroType.lexeme})`, stmt.body);
    }
    
    // TypeAnnotationVisitor methods for AstPrinter
    visitBasicTypeAnnotation(type: BasicTypeAnnotation): string {
        return type.name.lexeme;
    }
    visitArrayTypeAnnotation(type: ArrayTypeAnnotation): string { // NEW
        return `array(${type.elementType.accept(this)})`;
    }

    visitPointerTypeAnnotation(type: PointerTypeAnnotation): string {
        return `pointer(${type.baseType.accept(this)})`;
    }

    visitFunctionTypeAnnotation(type: FunctionTypeAnnotation): string {
        const params = type.parameters.map(p => this.printType(p)).join(", ");
        const returnType = this.printType(type.returnType);
        return `fun(${params})(${returnType})`;
    }

    printType(type: TypeAnnotation): string {
        return type.accept(this); // Delegate to TypeAnnotationVisitor methods
    }

    private parenthesize(name: string, ...parts: (ASTNode | string)[]): string {
        let result = `(${name}`;
        for (const part of parts) {
            if (part instanceof ASTNode) {
                result += ` ${this.print(part)}`;
            } else {
                result += ` ${part}`;
            }
        }
        result += ")";
        return result;
    }
}
