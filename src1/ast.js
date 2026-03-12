import { Token, TokenType } from './token.js';
// Base classes need a generic accept method for nodes that might be used in multiple contexts (like TypeAnnotation)
// However, for Stmt and Expr, we'll specialize them.
export class ASTNode {
}
// --- Expressions ---
export class Expr extends ASTNode {
}
export class LiteralExpr extends Expr {
    value;
    constructor(value) {
        super();
        this.value = value;
    }
    accept(visitor) { return visitor.visitLiteralExpr(this); }
}
export class BinaryExpr extends Expr {
    left;
    operator;
    right;
    constructor(left, operator, right) {
        super();
        this.left = left;
        this.operator = operator;
        this.right = right;
    }
    accept(visitor) { return visitor.visitBinaryExpr(this); }
}
export class UnaryExpr extends Expr {
    operator;
    right;
    constructor(operator, right) {
        super();
        this.operator = operator;
        this.right = right;
    }
    accept(visitor) { return visitor.visitUnaryExpr(this); }
}
export class AddressOfExpr extends Expr {
    expression;
    constructor(expression) {
        super();
        this.expression = expression;
    }
    accept(visitor) { return visitor.visitAddressOfExpr(this); }
}
export class DereferenceExpr extends Expr {
    expression;
    constructor(expression) {
        super();
        this.expression = expression;
    }
    accept(visitor) { return visitor.visitDereferenceExpr(this); }
}
export class IdentifierExpr extends Expr {
    name;
    constructor(name) {
        super();
        this.name = name;
    }
    accept(visitor) { return visitor.visitIdentifierExpr(this); }
}
export class GroupingExpr extends Expr {
    expression;
    constructor(expression) {
        super();
        this.expression = expression;
    }
    accept(visitor) { return visitor.visitGroupingExpr(this); }
}
export class CallExpr extends Expr {
    callee;
    paren;
    args;
    constructor(callee, paren, args) {
        super();
        this.callee = callee;
        this.paren = paren;
        this.args = args;
    }
    accept(visitor) { return visitor.visitCallExpr(this); }
}
export class GetExpr extends Expr {
    object;
    name;
    constructor(object, name) {
        super();
        this.object = object;
        this.name = name;
    }
    accept(visitor) { return visitor.visitGetExpr(this); }
}
export class IndexExpr extends Expr {
    array;
    index;
    constructor(array, index) {
        super();
        this.array = array;
        this.index = index;
    }
    accept(visitor) { return visitor.visitIndexExpr(this); }
}
export class AssignExpr extends Expr {
    target;
    value;
    constructor(target, value) {
        super();
        this.target = target;
        this.value = value;
    } // Changed name:Token to target:Expr
    accept(visitor) { return visitor.visitAssignExpr(this); }
}
export class ThisExpr extends Expr {
    keyword;
    constructor(keyword) {
        super();
        this.keyword = keyword;
    }
    accept(visitor) { return visitor.visitThisExpr(this); }
}
// NEW: AsExpr for type casting
export class AsExpr extends Expr {
    expression;
    type;
    constructor(expression, type) {
        super();
        this.expression = expression;
        this.type = type;
    }
    accept(visitor) { return visitor.visitAsExpr(this); }
}
// NEW: ObjectLiteralExpr for { key: value }
export class ObjectLiteralExpr extends Expr {
    properties;
    constructor(properties) {
        super();
        this.properties = properties;
    } // Using Map for properties
    accept(visitor) { return visitor.visitObjectLiteralExpr(this); }
}
// NEW: new Class(...) expression
export class NewExpr extends Expr {
    callee;
    args;
    constructor(callee, args) {
        super();
        this.callee = callee;
        this.args = args;
    }
    accept(visitor) { return visitor.visitNewExpr(this); }
}
// NEW: delete expr
export class DeleteExpr extends Expr {
    target;
    constructor(target) {
        super();
        this.target = target;
    }
    accept(visitor) { return visitor.visitDeleteExpr(this); }
}
export class FunctionLiteralExpr extends Expr {
    parameters;
    returnType;
    body;
    constructor(parameters, returnType, body) {
        super();
        this.parameters = parameters;
        this.returnType = returnType;
        this.body = body;
    }
    accept(visitor) { return visitor.visitFunctionLiteralExpr(this); }
}
// NEW: ArrayLiteralExpr for [element, element, ...]
export class ArrayLiteralExpr extends Expr {
    elements;
    constructor(elements) {
        super();
        this.elements = elements;
    }
    accept(visitor) { return visitor.visitArrayLiteralExpr(this); }
}
// --- Statements ---
export class Stmt extends ASTNode {
}
export class ExpressionStmt extends Stmt {
    expression;
    constructor(expression) {
        super();
        this.expression = expression;
    }
    accept(visitor) { return visitor.visitExpressionStmt(this); }
}
export class BlockStmt extends Stmt {
    statements;
    constructor(statements) {
        super();
        this.statements = statements;
    }
    accept(visitor) { return visitor.visitBlockStmt(this); }
}
export class TypeAnnotation extends ASTNode {
}
export class BasicTypeAnnotation extends TypeAnnotation {
    name;
    constructor(name) {
        super();
        this.name = name;
    }
    accept(visitor) { return visitor.visitBasicTypeAnnotation(this); }
}
// NEW: ArrayTypeAnnotation
export class ArrayTypeAnnotation extends TypeAnnotation {
    elementType;
    constructor(elementType) {
        super();
        this.elementType = elementType;
    }
    accept(visitor) {
        return visitor.visitArrayTypeAnnotation(this);
    }
}
export class PointerTypeAnnotation extends TypeAnnotation {
    baseType;
    constructor(baseType) {
        super();
        this.baseType = baseType;
    }
    accept(visitor) { return visitor.visitPointerTypeAnnotation(this); }
}
export class FunctionTypeAnnotation extends TypeAnnotation {
    parameters;
    returnType;
    constructor(parameters, returnType) {
        super();
        this.parameters = parameters;
        this.returnType = returnType;
    }
    accept(visitor) { return visitor.visitFunctionTypeAnnotation(this); }
}
export class LetStmt extends Stmt {
    name;
    type;
    initializer;
    isExported;
    constructor(name, type, initializer, isExported = false) {
        super();
        this.name = name;
        this.type = type;
        this.initializer = initializer;
        this.isExported = isExported;
    }
    accept(visitor) { return visitor.visitLetStmt(this); }
}
export class ConstStmt extends Stmt {
    name;
    type;
    initializer;
    isExported;
    constructor(name, type, initializer, isExported = false) {
        super();
        this.name = name;
        this.type = type;
        this.initializer = initializer;
        this.isExported = isExported;
    }
    accept(visitor) { return visitor.visitConstStmt(this); }
}
export class IfStmt extends Stmt {
    condition;
    thenBranch;
    elseBranch;
    constructor(condition, thenBranch, elseBranch) {
        super();
        this.condition = condition;
        this.thenBranch = thenBranch;
        this.elseBranch = elseBranch;
    }
    accept(visitor) { return visitor.visitIfStmt(this); }
}
export class WhileStmt extends Stmt {
    condition;
    body;
    constructor(condition, body) {
        super();
        this.condition = condition;
        this.body = body;
    }
    accept(visitor) { return visitor.visitWhileStmt(this); }
}
export class ReturnStmt extends Stmt {
    keyword;
    value;
    constructor(keyword, value) {
        super();
        this.keyword = keyword;
        this.value = value;
    }
    accept(visitor) { return visitor.visitReturnStmt(this); }
}
export class Parameter extends ASTNode {
    name;
    type;
    constructor(name, type) {
        super();
        this.name = name;
        this.type = type;
    }
    accept(visitor) { throw new Error("Parameters should not be visited directly by a generic visitor. Use a specific visitor for type analysis if needed."); }
}
export class FunctionDeclaration extends Stmt {
    name;
    parameters;
    returnType;
    body;
    isExported;
    visibility;
    capturedVariables;
    isStatic;
    constructor(name, parameters, returnType, body, isExported = false, visibility, // Add visibility field
    capturedVariables = null, isStatic = false) {
        super();
        this.name = name;
        this.parameters = parameters;
        this.returnType = returnType;
        this.body = body;
        this.isExported = isExported;
        this.visibility = visibility;
        this.capturedVariables = capturedVariables;
        this.isStatic = isStatic;
    }
    accept(visitor) { return visitor.visitFunctionDeclaration(this); }
}
export class PropertyDeclaration extends Stmt {
    visibility;
    name;
    type;
    initializer;
    constructor(visibility, name, type, initializer) {
        super();
        this.visibility = visibility;
        this.name = name;
        this.type = type;
        this.initializer = initializer;
    }
    accept(visitor) { return visitor.visitPropertyDeclaration(this); }
}
export class DeclareFunction extends Stmt {
    name;
    parameters;
    returnType;
    constructor(name, parameters, returnType) {
        super();
        this.name = name;
        this.parameters = parameters;
        this.returnType = returnType;
    }
    accept(visitor) { return visitor.visitDeclareFunction(this); }
}
export class ClassDeclaration extends Stmt {
    name;
    properties;
    methods;
    isExported;
    isDeclare;
    constructor(name, properties, methods, isExported = false, isDeclare = false) {
        super();
        this.name = name;
        this.properties = properties;
        this.methods = methods;
        this.isExported = isExported;
        this.isDeclare = isDeclare;
    }
    accept(visitor) { return visitor.visitClassDeclaration(this); }
}
export class StructDeclaration extends Stmt {
    name;
    properties;
    isExported;
    isDeclare;
    constructor(name, properties, isExported = false, isDeclare = false) {
        super();
        this.name = name;
        this.properties = properties;
        this.isExported = isExported;
        this.isDeclare = isDeclare;
    }
    accept(visitor) { return visitor.visitStructDeclaration(this); }
}
export class ImportStmt extends Stmt {
    sourcePath;
    namespaceAlias;
    isDeclare;
    constructor(sourcePath, // 导入的模块路径，例如 "modulePath"
    namespaceAlias, // 命名空间别名，例如 `identifier` (for `import identifier from ...`)
    isDeclare = false) {
        super();
        this.sourcePath = sourcePath;
        this.namespaceAlias = namespaceAlias;
        this.isDeclare = isDeclare;
    }
    accept(visitor) { return visitor.visitImportStmt(this); }
}
export class UsingStmt extends Stmt {
    path;
    alias;
    isDeclare;
    constructor(path, alias, isDeclare = false) {
        super();
        this.path = path;
        this.alias = alias;
        this.isDeclare = isDeclare;
    }
    accept(visitor) { return visitor.visitUsingStmt(this); } // Need to add visitUsingStmt to StmtVisitor
}
// --- AST Printer ---
// AstPrinter now needs to handle both visitor types
export class AstPrinter {
    print(node) {
        if (node === null)
            return "(null)";
        // TypeAnnotation nodes now have their own visitor accept method
        if (node instanceof TypeAnnotation) {
            return node.accept(this); // Delegate to TypeAnnotationVisitor
        }
        return node.accept(this);
    }
    visitLiteralExpr(expr) { if (expr.value === null)
        return "nil"; return String(expr.value); }
    visitIdentifierExpr(expr) { return expr.name.lexeme; }
    visitUnaryExpr(expr) { return this.parenthesize(expr.operator.lexeme, expr.right); }
    visitBinaryExpr(expr) { return this.parenthesize(expr.operator.lexeme, expr.left, expr.right); }
    visitGroupingExpr(expr) { return this.parenthesize("group", expr.expression); }
    visitCallExpr(expr) { return this.parenthesize("call " + this.print(expr.callee), ...expr.args); }
    visitGetExpr(expr) { return this.parenthesize("get " + this.print(expr.object) + "." + expr.name.lexeme); }
    visitIndexExpr(expr) { return this.parenthesize("index", expr.array, expr.index); }
    visitAssignExpr(expr) { return this.parenthesize("assign " + this.print(expr.target), expr.value); }
    visitThisExpr(expr) { return expr.keyword.lexeme; }
    // NEW: AsExpr for type casting
    visitAsExpr(expr) {
        return this.parenthesize(`as ${this.printType(expr.type)}`, expr.expression);
    }
    // NEW: ObjectLiteralExpr for { key: value }
    visitObjectLiteralExpr(expr) {
        const properties = Array.from(expr.properties.entries())
            .map(([key, value]) => `${key.lexeme}: ${this.print(value)}`)
            .join(", ");
        return this.parenthesize(`object { ${properties} }`);
    }
    visitNewExpr(expr) {
        const args = expr.args.map(a => this.print(a));
        return this.parenthesize("new " + this.print(expr.callee), ...args);
    }
    visitDeleteExpr(expr) {
        return this.parenthesize("delete", expr.target);
    }
    visitAddressOfExpr(expr) {
        return this.parenthesize("addrof", expr.expression);
    }
    visitDereferenceExpr(expr) {
        return this.parenthesize("deref", expr.expression);
    }
    visitFunctionLiteralExpr(expr) {
        const params = expr.parameters.map(p => {
            const typeStr = p.type ? `: ${this.printType(p.type)}` : '';
            return `${p.name.lexeme}${typeStr}`;
        }).join(" ");
        const returnType = expr.returnType ? `: ${this.printType(expr.returnType)}` : '';
        return this.parenthesize(`fun literal(${params})${returnType}`, expr.body);
    }
    // NEW: ArrayLiteralExpr
    visitArrayLiteralExpr(expr) {
        const elements = expr.elements.map(e => this.print(e)).join(", ");
        return this.parenthesize(`array [${elements}]`);
    }
    visitExpressionStmt(stmt) { return this.parenthesize("expr", stmt.expression); }
    visitLetStmt(stmt) {
        const typeStr = stmt.type ? `: ${this.printType(stmt.type)}` : '';
        if (stmt.initializer === null) {
            return this.parenthesize(`let ${stmt.name.lexeme}${typeStr}`);
        }
        return this.parenthesize(`let ${stmt.name.lexeme}${typeStr} =`, stmt.initializer);
    }
    visitConstStmt(stmt) {
        const typeStr = stmt.type ? `: ${this.printType(stmt.type)}` : '';
        if (stmt.initializer === null) {
            return this.parenthesize(`const ${stmt.name.lexeme}${typeStr}`);
        }
        return this.parenthesize(`const ${stmt.name.lexeme}${typeStr} =`, stmt.initializer);
    }
    visitBlockStmt(stmt) { return this.parenthesize("block", ...stmt.statements); }
    visitIfStmt(stmt) {
        if (stmt.elseBranch) {
            return this.parenthesize("if", stmt.condition, stmt.thenBranch, stmt.elseBranch);
        }
        return this.parenthesize("if", stmt.condition, stmt.thenBranch);
    }
    visitWhileStmt(stmt) { return this.parenthesize("while", stmt.condition, stmt.body); }
    visitReturnStmt(stmt) {
        if (stmt.value === null) {
            return `(return)`;
        }
        return this.parenthesize("return", stmt.value);
    }
    visitFunctionDeclaration(decl) {
        const params = decl.parameters.map(p => {
            const typeStr = p.type ? `: ${this.printType(p.type)}` : '';
            return `${p.name.lexeme}${typeStr}`;
        }).join(" ");
        const returnType = decl.returnType ? `: ${this.printType(decl.returnType)}` : '';
        const staticPrefix = decl.isStatic ? 'static ' : '';
        return this.parenthesize(`${staticPrefix}fun ${decl.name.lexeme}(${params})${returnType}`, decl.body);
    }
    visitClassDeclaration(stmt) {
        return this.parenthesize(`class ${stmt.name.lexeme}`, ...stmt.properties, ...stmt.methods); // Print methods too
    }
    visitStructDeclaration(decl) {
        return this.parenthesize(`struct ${decl.name.lexeme}`, ...decl.properties);
    }
    visitPropertyDeclaration(stmt) {
        const visibility = stmt.visibility.lexeme;
        const typeStr = stmt.type ? `: ${this.printType(stmt.type)}` : '';
        if (stmt.initializer === null) {
            return this.parenthesize(`${visibility} ${stmt.name.lexeme}${typeStr}`);
        }
        return this.parenthesize(`${visibility} ${stmt.name.lexeme}${typeStr} =`, stmt.initializer);
    }
    visitImportStmt(stmt) {
        // Updated to use sourcePath and namespaceAlias
        const aliasPart = stmt.namespaceAlias ? ` as ${stmt.namespaceAlias.lexeme}` : '';
        return this.parenthesize(`import ${stmt.sourcePath.literal}${aliasPart}`);
    }
    visitDeclareFunction(decl) {
        const params = decl.parameters.map(p => {
            const typeStr = p.type ? `: ${this.printType(p.type)}` : '';
            return `${p.name.lexeme}${typeStr}`;
        }).join(" ");
        const returnType = decl.returnType ? `: ${this.printType(decl.returnType)}` : '';
        return this.parenthesize(`declare fun ${decl.name.lexeme}(${params})${returnType}`);
    }
    visitUsingStmt(stmt) {
        const aliasPart = stmt.alias ? ` as ${stmt.alias.lexeme}` : '';
        return this.parenthesize(`using ${stmt.path.literal}${aliasPart}`);
    }
    // TypeAnnotationVisitor methods for AstPrinter
    visitBasicTypeAnnotation(type) {
        return type.name.lexeme;
    }
    visitArrayTypeAnnotation(type) {
        return `array(${type.elementType.accept(this)})`;
    }
    visitPointerTypeAnnotation(type) {
        return `pointer(${type.baseType.accept(this)})`;
    }
    visitFunctionTypeAnnotation(type) {
        const params = type.parameters.map(p => this.printType(p)).join(", ");
        const returnType = this.printType(type.returnType);
        return `fun(${params})(${returnType})`;
    }
    printType(type) {
        return type.accept(this); // Delegate to TypeAnnotationVisitor methods
    }
    parenthesize(name, ...parts) {
        let result = `(${name}`;
        for (const part of parts) {
            if (part instanceof ASTNode) {
                result += ` ${this.print(part)}`;
            }
            else {
                result += ` ${part}`;
            }
        }
        result += ")";
        return result;
    }
}
//# sourceMappingURL=ast.js.map