// src/generator/cpp_generator.ts
import {
    ASTNode, type ExprVisitor, type StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, IndexExpr, AssignExpr, ThisExpr, AsExpr, AwaitExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, AddressOfExpr, DereferenceExpr, FunctionLiteralExpr, ArrayLiteralExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction, UsingStmt,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation, PromiseTypeAnnotation, Parameter
} from '../ast.js';
import { Token, TokenType } from '../token.js';
import { Parser } from '../parser/index.js';

export class CppGenerator implements ExprVisitor<string>, StmtVisitor<string> {
    private indentLevel: number = 0;
    private classes: Map<string, ClassDeclaration> = new Map();
    private structs: Map<string, StructDeclaration> = new Map();
    private currentFunctionName: string | null = null;
    private mangle: boolean;
    private labelCounter: number = 0;
    private namespaceImports: Map<string, Map<string, string>>;

    constructor(public platform: any, parser: Parser, mangle: boolean, public path: string, public debug: boolean) {
        this.mangle = mangle;
        this.namespaceImports = parser.namespaceImports;
    }

    private indent(): string {
        return '    '.repeat(this.indentLevel);
    }

    private mangleName(name: string): string {
        if (!this.mangle || name === 'main') return name;
        return `yu_${name}`;
    }

    private getCppType(type: TypeAnnotation | null): string {
        if (!type) return 'void*';

        if (type instanceof BasicTypeAnnotation) {
            const name = type.name.lexeme;
            switch (name) {
                case 'i8': return 'int8_t';
                case 'i16': return 'int16_t';
                case 'i32': return 'int32_t';
                case 'i64': return 'int64_t';
                case 'u8': return 'uint8_t';
                case 'u16': return 'uint16_t';
                case 'u32': return 'uint32_t';
                case 'u64': return 'uint64_t';
                case 'f32': return 'float';
                case 'f64': return 'double';
                case 'bool': return 'bool';
                case 'void': return 'void';
                case 'string': return 'yu_string';
                case 'object': return 'void*';
                default:
                    if (this.classes.has(name)) return `yu_class_${name}*`;
                    if (this.structs.has(name)) return `yu_struct_${name}`;
                    return `yu_struct_${name}*`; // Assume pointer for unknown types (likely classes/structs)
            }
        }

        if (type instanceof ArrayTypeAnnotation) {
            return 'yu_array';
        }

        if (type instanceof PointerTypeAnnotation) {
            return `${this.getCppType(type.baseType)}*`;
        }

        if (type instanceof FunctionTypeAnnotation) {
            // C style function pointer for closures: void (*)(void* env, ...)
            const params = ['void*'];
            type.parameters.forEach(p => params.push(this.getCppType(p)));
            return `struct { ${this.getCppType(type.returnType)} (*code)(${params.join(', ')}); void* env; }`;
        }

        if (type instanceof PromiseTypeAnnotation) {
            return 'yu_promise*';
        }

        return 'void*';
    }

    public generate(nodes: ASTNode[]): string {
        let code = '#include "yu_runtime.h"\n';
        code += '#include <stdint.h>\n';
        code += '#include <stdbool.h>\n';
        code += '#include <stdio.h>\n';
        code += '#include <string.h>\n\n';

        // Pre-declare classes and structs
        nodes.forEach(n => {
            if (n instanceof ClassDeclaration) {
                this.classes.set(n.name.lexeme, n);
                code += `typedef struct yu_class_${n.name.lexeme} yu_class_${n.name.lexeme};\n`;
            } else if (n instanceof StructDeclaration) {
                this.structs.set(n.name.lexeme, n);
                code += `typedef struct yu_struct_${n.name.lexeme} yu_struct_${n.name.lexeme};\n`;
            }
        });

        // Define structs
        nodes.forEach(n => {
            if (n instanceof StructDeclaration) {
                code += `struct yu_struct_${n.name.lexeme} {\n`;
                this.indentLevel++;
                n.properties.forEach(p => {
                    code += `${this.indent()}${this.getCppType(p.type)} ${p.name.lexeme};\n`;
                });
                this.indentLevel--;
                code += '};\n\n';
            }
        });

        // Define class structs
        nodes.forEach(n => {
            if (n instanceof ClassDeclaration) {
                code += `struct yu_class_${n.name.lexeme} {\n`;
                this.indentLevel++;
                n.properties.forEach(p => {
                    code += `${this.indent()}${this.getCppType(p.type)} ${p.name.lexeme};\n`;
                });
                this.indentLevel--;
                code += '};\n\n';
            }
        });

        // Function declarations
        nodes.forEach(n => {
            if (n instanceof FunctionDeclaration) {
                const rt = this.getCppType(n.returnType);
                const params = n.parameters.map(p => `${this.getCppType(p.type)} ${p.name.lexeme}`).join(', ');
                code += `${rt} ${this.mangleName(n.name.lexeme)}(${params});\n`;
            } else if (n instanceof DeclareFunction) {
                const rt = this.getCppType(n.returnType);
                const params = n.parameters.map(p => `${this.getCppType(p.type)} ${p.name.lexeme}`).join(', ');
                code += `extern "C" ${rt} ${n.name.lexeme}(${params});\n`;
            }
        });

        // Class methods declarations
        nodes.forEach(n => {
            if (n instanceof ClassDeclaration) {
                const className = n.name.lexeme;
                n.methods.forEach(m => {
                    const rt = this.getCppType(m.returnType);
                    const params = [`yu_class_${className}* this`];
                    m.parameters.forEach(p => params.push(`${this.getCppType(p.type)} ${p.name.lexeme}`));
                    code += `${rt} yu_class_${className}_${m.name.lexeme}(${params.join(', ')});\n`;
                });
            }
        });

        code += '\n';

        // Definitions
        nodes.forEach(n => {
            if (n instanceof Stmt) {
                code += n.accept(this);
            }
        });

        return code;
    }

    visitLiteralExpr(expr: LiteralExpr): string {
        if (typeof expr.value === 'string') {
            return `(yu_string){(char*)"${expr.value}", ${expr.value.length}}`;
        }
        if (typeof expr.value === 'number') {
            return expr.value.toString();
        }
        if (typeof expr.value === 'boolean') {
            return expr.value ? 'true' : 'false';
        }
        return 'NULL';
    }

    visitIdentifierExpr(expr: IdentifierExpr): string {
        return expr.name.lexeme;
    }

    visitBinaryExpr(expr: BinaryExpr): string {
        const left = expr.left.accept(this);
        const right = expr.right.accept(this);
        return `(${left} ${expr.operator.lexeme} ${right})`;
    }

    visitUnaryExpr(expr: UnaryExpr): string {
        return `(${expr.operator.lexeme}${expr.right.accept(this)})`;
    }

    visitGroupingExpr(expr: GroupingExpr): string {
        return `(${expr.expression.accept(this)})`;
    }

    visitCallExpr(expr: CallExpr): string {
        if (expr.callee instanceof GetExpr) {
            const objExpr = expr.callee.object;
            const name = expr.callee.name.lexeme;

            if (objExpr instanceof IdentifierExpr && objExpr.name.lexeme === 'clib') {
                return `${name}(${expr.args.map(a => a.accept(this)).join(', ')})`;
            }

            if (objExpr instanceof IdentifierExpr && objExpr.name.lexeme === 'uv') {
                return `yu_uv_${name}(${expr.args.map(a => a.accept(this)).join(', ')})`;
            }

            // Handle method call like arr.push(val)
            const obj = objExpr.accept(this);
            if (name === 'push') {
                const val = expr.args[0]!.accept(this);
                const arrVar = `arr_push_${this.labelCounter++}`;
                // Simplified push implementation in C++
                return `({ yu_array* ${arrVar} = &${obj}; if (${arrVar}->length >= ${arrVar}->capacity) { ${arrVar}->capacity = ${arrVar}->capacity == 0 ? 4 : ${arrVar}->capacity * 2; ${arrVar}->ptr = GC_realloc(${arrVar}->ptr, ${arrVar}->capacity * sizeof(void*)); } ((void**)${arrVar}->ptr)[${arrVar}->length++] = (void*)(intptr_t)${val}; ${arrVar}->length; })`;
            }

            // Handle class methods
            const args = [obj, ...expr.args.map(a => a.accept(this))].join(', ');
            if (this.currentClass) {
                return `yu_class_${this.currentClass}_${name}(${args})`;
            }
            return `yu_method_${name}(${args})`;
        }

        const callee = expr.callee.accept(this);
        const args = expr.args.map(a => a.accept(this)).join(', ');
        return `${callee}(${args})`;
    }

    visitGetExpr(expr: GetExpr): string {
        const obj = expr.object.accept(this);
        const name = expr.name.lexeme;

        if (expr.object instanceof IdentifierExpr && expr.object.name.lexeme === 'clib') {
            return name;
        }

        if (expr.object instanceof IdentifierExpr && expr.object.name.lexeme === 'uv') {
            return `yu_uv_${name}`;
        }

        // Handle properties like length
        if (name === 'length') {
            return `${obj}.length`;
        }
        if (name === 'ptr') {
            return `${obj}.ptr`;
        }

        // Default to pointer access
        return `${obj}->${name}`;
    }

    visitIndexExpr(expr: IndexExpr): string {
        const arr = expr.array.accept(this);
        const idx = expr.index.accept(this);
        // This depends on the type of array. 
        // For yu_array, we might need a helper function or direct access.
        return `((void**)${arr}.ptr)[${idx}]`; 
    }

    visitAssignExpr(expr: AssignExpr): string {
        const target = expr.target.accept(this);
        const value = expr.value.accept(this);
        return `${target} = ${value}`;
    }

    visitThisExpr(expr: ThisExpr): string {
        return 'this';
    }

    visitAsExpr(expr: AsExpr): string {
        const value = expr.expression.accept(this);
        const type = this.getCppType(expr.type);
        return `(${type})(${value})`;
    }

    visitAwaitExpr(expr: AwaitExpr): string {
        const inner = expr.expression.accept(this);
        // Await logic: while (!promise->resolved) yu_uv_run();
        const promiseVar = `promise_${this.labelCounter++}`;
        return `({ yu_promise* ${promiseVar} = ${inner}; while (!${promiseVar}->resolved) yu_uv_run(); ${promiseVar}->value; })`;
    }

    visitObjectLiteralExpr(expr: ObjectLiteralExpr): string {
        return 'NULL'; // Not fully implemented
    }

    visitNewExpr(expr: NewExpr): string {
        if (expr.callee instanceof IdentifierExpr) {
            const className = expr.callee.name.lexeme;
            const resVar = `new_obj_${this.labelCounter++}`;
            let code = `({ yu_class_${className}* ${resVar} = (yu_class_${className}*)GC_malloc(sizeof(yu_class_${className})); `;
            // Call init if exists
            const classDecl = this.classes.get(className);
            if (classDecl && classDecl.methods.some(m => m.name.lexeme === 'init')) {
                const args = expr.args.map(a => a.accept(this)).join(', ');
                code += `yu_class_${className}_init(${resVar}${args ? ', ' + args : ''}); `;
            }
            code += `${resVar}; })`;
            return code;
        }
        return 'NULL';
    }

    visitDeleteExpr(expr: DeleteExpr): string {
        return ''; // GC handles it
    }

    visitAddressOfExpr(expr: AddressOfExpr): string {
        return `&(${expr.expression.accept(this)})`;
    }

    visitDereferenceExpr(expr: DereferenceExpr): string {
        return `*(${expr.expression.accept(this)})`;
    }

    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): string {
        // Closures are complex in C. We need to generate a helper function and a struct.
        return 'NULL'; // TODO: Implement closures
    }

    visitArrayLiteralExpr(expr: ArrayLiteralExpr): string {
        const elements = expr.elements.map(e => e.accept(this));
        const arrVar = `arr_${this.labelCounter++}`;
        const len = elements.length;
        let code = `({ yu_array ${arrVar}; ${arrVar}.length = ${len}; ${arrVar}.capacity = ${len}; `;
        code += `${arrVar}.ptr = GC_malloc(sizeof(void*) * ${len}); `;
        elements.forEach((e, i) => {
            code += `((void**)${arrVar}.ptr)[${i}] = (void*)${e}; `;
        });
        code += `${arrVar}; })`;
        return code;
    }

    visitExpressionStmt(stmt: ExpressionStmt): string {
        return `${this.indent()}${stmt.expression.accept(this)};\n`;
    }

    visitBlockStmt(stmt: BlockStmt): string {
        let code = '{\n';
        this.indentLevel++;
        stmt.statements.forEach(s => {
            code += s.accept(this);
        });
        this.indentLevel--;
        code += `${this.indent()}}\n`;
        return code;
    }

    visitLetStmt(stmt: LetStmt): string {
        const type = this.getCppType(stmt.type || (stmt.initializer instanceof FunctionLiteralExpr ? null : null)); // Simplified
        const init = stmt.initializer ? ` = ${stmt.initializer.accept(this)}` : '';
        return `${this.indent()}${type} ${stmt.name.lexeme}${init};\n`;
    }

    visitConstStmt(stmt: ConstStmt): string {
        const type = this.getCppType(stmt.type);
        const init = stmt.initializer ? ` = ${stmt.initializer.accept(this)}` : '';
        return `${this.indent()}const ${type} ${stmt.name.lexeme}${init};\n`;
    }

    visitIfStmt(stmt: IfStmt): string {
        let code = `${this.indent()}if (${stmt.condition.accept(this)}) ${stmt.thenBranch.accept(this)}`;
        if (stmt.elseBranch) {
            code += `${this.indent()}else ${stmt.elseBranch.accept(this)}`;
        }
        return code;
    }

    visitWhileStmt(stmt: WhileStmt): string {
        return `${this.indent()}while (${stmt.condition.accept(this)}) ${stmt.body.accept(this)}`;
    }

    visitReturnStmt(stmt: ReturnStmt): string {
        const val = stmt.value ? ` ${stmt.value.accept(this)}` : '';
        return `${this.indent()}return${val};\n`;
    }

    visitFunctionDeclaration(decl: FunctionDeclaration): string {
        const name = this.mangleName(decl.name.lexeme);
        const rt = this.getCppType(decl.returnType);
        const params = decl.parameters.map(p => `${this.getCppType(p.type)} ${p.name.lexeme}`).join(', ');
        
        this.currentFunctionName = name;
        let code = `${rt} ${name}(${params}) `;
        code += decl.body.accept(this);
        this.currentFunctionName = null;

        if (name === 'main') {
            // Add a real C main that calls yu_main and handles args
            code += `\nint main(int argc, char** argv) {\n`;
            code += `    GC_init();\n`;
            code += `    yu_uv_init();\n`;
            // Convert argv to yu_array of yu_string
            code += `    yu_array args;\n`;
            code += `    args.length = argc;\n`;
            code += `    args.capacity = argc;\n`;
            code += `    args.ptr = GC_malloc(sizeof(yu_string) * argc);\n`;
            code += `    for (int i = 0; i < argc; i++) {\n`;
            code += `        ((yu_string*)args.ptr)[i] = (yu_string){argv[i], (int64_t)strlen(argv[i])};\n`;
            code += `    }\n`;
            code += `    yu_main(args);\n`;
            code += `    return yu_uv_run();\n`;
            code += `}\n`;
        }
        return code;
    }

    visitClassDeclaration(decl: ClassDeclaration): string {
        let code = '';
        const className = decl.name.lexeme;
        this.currentClass = className;
        decl.methods.forEach(m => {
            const rt = this.getCppType(m.returnType);
            const params = [`yu_class_${className}* this`];
            m.parameters.forEach(p => params.push(`${this.getCppType(p.type)} ${p.name.lexeme}`));
            code += `${rt} yu_class_${className}_${m.name.lexeme}(${params.join(', ')}) `;
            code += m.body.accept(this);
        });
        this.currentClass = null;
        return code;
    }

    visitStructDeclaration(decl: StructDeclaration): string {
        return ''; // Handled in pre-pass
    }

    visitPropertyDeclaration(stmt: PropertyDeclaration): string {
        return ''; // Handled in class/struct definition
    }

    visitImportStmt(stmt: ImportStmt): string {
        return ''; // Module resolution is handled before generation
    }

    visitDeclareFunction(decl: DeclareFunction): string {
        return ''; // Handled in declarations
    }

    visitUsingStmt(stmt: UsingStmt): string {
        return '';
    }
}
