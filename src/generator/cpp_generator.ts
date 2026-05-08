// src/generator/cpp_generator.ts
import {
    ASTNode, type ExprVisitor, type StmtVisitor,
    Expr, LiteralExpr, BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, IndexExpr, AssignExpr, ThisExpr, AsExpr, AwaitExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, AddressOfExpr, DereferenceExpr, FunctionLiteralExpr, ArrayLiteralExpr,
    Stmt, ExpressionStmt, BlockStmt, LetStmt, ConstStmt, IfStmt, WhileStmt, ReturnStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, ImportStmt, DeclareFunction, UsingStmt,
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation, PromiseTypeAnnotation, Parameter
} from '../ast.js';
import { Token, TokenType } from '../token.js';
import { Parser } from '../parser/index.js';

type Scope = Map<string, TypeAnnotation | null>;

export class CppGenerator implements ExprVisitor<string>, StmtVisitor<string> {
    private indentLevel = 0;
    private classes: Map<string, ClassDeclaration> = new Map();
    private structs: Map<string, StructDeclaration> = new Map();
    private functions: Map<string, FunctionDeclaration | DeclareFunction> = new Map();
    private scopes: Scope[] = [];
    private expectedTypes: (TypeAnnotation | null)[] = [];
    private currentClass: string | null = null;
    private labelCounter = 0;
    private namespaceImports: Map<string, Map<string, string>>;

    constructor(public platform: any, parser: Parser, private mangle: boolean, public path: string, public debug: boolean) {
        this.namespaceImports = parser.namespaceImports;
    }

    private indent(): string {
        return '    '.repeat(this.indentLevel);
    }

    private pushScope(): void {
        this.scopes.push(new Map());
    }

    private popScope(): void {
        this.scopes.pop();
    }

    private define(name: string, type: TypeAnnotation | null): void {
        if (this.scopes.length === 0) this.pushScope();
        this.scopes[this.scopes.length - 1]!.set(name, type);
    }

    private lookup(name: string): TypeAnnotation | null | undefined {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const scope = this.scopes[i]!;
            if (scope.has(name)) return scope.get(name) ?? null;
        }
        return undefined;
    }

    private withExpectedType<T>(type: TypeAnnotation | null | undefined, fn: () => T): T {
        this.expectedTypes.push(type ?? null);
        try {
            return fn();
        } finally {
            this.expectedTypes.pop();
        }
    }

    private currentExpectedType(): TypeAnnotation | null {
        return this.expectedTypes[this.expectedTypes.length - 1] ?? null;
    }

    private token(name: string): Token {
        return new Token(TokenType.IDENTIFIER, name, null, 0, 0);
    }

    private basic(name: string): BasicTypeAnnotation {
        return new BasicTypeAnnotation(this.token(name));
    }

    private voidType(): BasicTypeAnnotation {
        return this.basic('void');
    }

    private mangleName(name: string): string {
        if (!this.mangle) return name;
        if (name.startsWith('yu_')) return name;
        return `yu_${name}`;
    }

    private rawStringLiteral(value: string): string {
        let out = '"';
        for (const ch of value) {
            switch (ch) {
                case '\\': out += '\\\\'; break;
                case '"': out += '\\"'; break;
                case '\n': out += '\\n'; break;
                case '\r': out += '\\r'; break;
                case '\t': out += '\\t'; break;
                case '\0': out += '\\0'; break;
                default: out += ch; break;
            }
        }
        out += '"';
        return out;
    }

    private yuStringLiteral(value: string): string {
        return `yu_string{(char*)${this.rawStringLiteral(value)}, ${value.length}}`;
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
                case 'char': return 'char';
                case 'object': return 'void*';
                default:
                    if (this.classes.has(name)) return `yu_class_${name}*`;
                    if (this.structs.has(name)) return `yu_struct_${name}`;
                    return `yu_struct_${name}*`;
            }
        }

        if (type instanceof ArrayTypeAnnotation) {
            return 'yu_array';
        }

        if (type instanceof PointerTypeAnnotation) {
            return `${this.getCppType(type.baseType)}*`;
        }

        if (type instanceof FunctionTypeAnnotation) {
            const params = type.parameters.map(p => this.getCppType(p)).join(', ');
            return `std::function<${this.getCppType(type.returnType)}(${params})>`;
        }

        if (type instanceof PromiseTypeAnnotation) {
            return 'yu_promise*';
        }

        return 'void*';
    }

    private collectSymbols(nodes: ASTNode[]): void {
        for (const n of nodes) {
            if (n instanceof ClassDeclaration) {
                this.classes.set(n.name.lexeme, n);
            } else if (n instanceof StructDeclaration) {
                this.structs.set(n.name.lexeme, n);
            }
        }

        for (const n of nodes) {
            if (n instanceof FunctionDeclaration || n instanceof DeclareFunction) {
                this.functions.set(n.name.lexeme, n);
            }
        }
    }

    public generate(nodes: ASTNode[]): string {
        this.collectSymbols(nodes);

        let code = '#include "yu_runtime.h"\n';
        code += '#include <stdint.h>\n';
        code += '#include <stdbool.h>\n';
        code += '#include <stdio.h>\n';
        code += '#include <string.h>\n';
        code += '#include <functional>\n';
        code += '#include <utility>\n\n';
        code += this.runtimeCallbackHelpers();

        for (const [name] of this.classes) {
            code += `typedef struct yu_class_${name} yu_class_${name};\n`;
        }
        for (const [name] of this.structs) {
            code += `typedef struct yu_struct_${name} yu_struct_${name};\n`;
        }
        if (this.classes.size > 0 || this.structs.size > 0) code += '\n';

        for (const n of nodes) {
            if (n instanceof StructDeclaration) {
                code += `struct yu_struct_${n.name.lexeme} {\n`;
                this.indentLevel++;
                for (const p of n.properties) {
                    code += `${this.indent()}${this.getCppType(p.type)} ${p.name.lexeme};\n`;
                }
                this.indentLevel--;
                code += '};\n\n';
            }
        }

        for (const n of nodes) {
            if (n instanceof ClassDeclaration) {
                code += `struct yu_class_${n.name.lexeme} {\n`;
                this.indentLevel++;
                for (const p of n.properties) {
                    code += `${this.indent()}${this.getCppType(p.type)} ${p.name.lexeme};\n`;
                }
                this.indentLevel--;
                code += '};\n\n';
            }
        }

        for (const n of nodes) {
            if (n instanceof FunctionDeclaration) {
                code += `${this.getCppType(n.returnType ?? this.voidType())} ${this.mangleName(n.name.lexeme)}(${this.renderParameters(n.parameters)});\n`;
            } else if (n instanceof DeclareFunction) {
                code += `extern "C" ${this.getCppType(n.returnType ?? this.voidType())} ${n.name.lexeme}(${this.renderParameters(n.parameters)});\n`;
            }
        }

        for (const n of nodes) {
            if (n instanceof ClassDeclaration) {
                for (const m of n.methods) {
                    const params = [`yu_class_${n.name.lexeme}* self`, ...m.parameters.map(p => `${this.getCppType(p.type)} ${p.name.lexeme}`)];
                    code += `${this.getCppType(m.returnType ?? this.voidType())} yu_class_${n.name.lexeme}_${m.name.lexeme}(${params.join(', ')});\n`;
                }
            }
        }
        code += '\n';

        this.pushScope();
        for (const n of nodes) {
            if (n instanceof LetStmt || n instanceof ConstStmt) {
                this.define(n.name.lexeme, n.type);
            }
        }

        for (const n of nodes) {
            if (n instanceof Stmt) {
                code += n.accept(this);
            }
        }

        if (this.mangle && this.functions.has('main')) {
            code += this.emitHostMain(this.functions.get('main')!);
        }
        this.popScope();

        return code;
    }

    private runtimeCallbackHelpers(): string {
        return [
            'using yu_cb_status_t = std::function<void(int32_t)>;',
            'using yu_cb_i64_t = std::function<void(int64_t)>;',
            'using yu_cb_err_string_t = std::function<void(int32_t, yu_string)>;',
            'static void yu_cb_status_thunk(void* env, int32_t status) { (*static_cast<yu_cb_status_t*>(env))(status); }',
            'static void yu_cb_i64_thunk(void* env, int64_t value) { (*static_cast<yu_cb_i64_t*>(env))(value); }',
            'static void yu_cb_err_string_thunk(void* env, int32_t err, yu_string data) { (*static_cast<yu_cb_err_string_t*>(env))(err, data); }',
            'static void* yu_cb_status_env(yu_cb_status_t cb) { return new yu_cb_status_t(std::move(cb)); }',
            'static void* yu_cb_i64_env(yu_cb_i64_t cb) { return new yu_cb_i64_t(std::move(cb)); }',
            'static void* yu_cb_err_string_env(yu_cb_err_string_t cb) { return new yu_cb_err_string_t(std::move(cb)); }',
            '',
            ''
        ].join('\n');
    }

    private renderParameters(parameters: Parameter[]): string {
        return parameters.map(p => `${this.getCppType(p.type)} ${p.name.lexeme}`).join(', ');
    }

    private emitHostMain(mainDecl: FunctionDeclaration | DeclareFunction): string {
        const mainParams = mainDecl.parameters.length;
        const returnsVoid = !mainDecl.returnType || this.getCppType(mainDecl.returnType) === 'void';

        let code = '\nint main(int argc, char** argv) {\n';
        code += '    GC_init();\n';
        code += '    yu_uv_init();\n';
        code += '    yu_array args;\n';
        code += '    args.length = argc;\n';
        code += '    args.capacity = argc;\n';
        code += '    args.ptr = GC_malloc(sizeof(yu_string) * argc);\n';
        code += '    for (int i = 0; i < argc; i++) {\n';
        code += '        ((yu_string*)args.ptr)[i] = yu_string{argv[i], (int64_t)strlen(argv[i])};\n';
        code += '    }\n';
        if (returnsVoid) {
            code += mainParams > 0 ? '    yu_main(args);\n' : '    yu_main();\n';
            code += '    return yu_uv_run();\n';
        } else {
            code += mainParams > 0 ? '    int32_t yu_exit_code = yu_main(args);\n' : '    int32_t yu_exit_code = yu_main();\n';
            code += '    int32_t yu_uv_code = yu_uv_run();\n';
            code += '    return yu_exit_code != 0 ? yu_exit_code : yu_uv_code;\n';
        }
        code += '}\n';
        return code;
    }

    private functionTypeFromDeclaration(decl: FunctionDeclaration | DeclareFunction): FunctionTypeAnnotation {
        return new FunctionTypeAnnotation(
            decl.parameters.map(p => p.type ?? this.basic('object')),
            decl.returnType ?? this.voidType()
        );
    }

    private expressionType(expr: Expr): TypeAnnotation | null {
        if (expr instanceof LiteralExpr) {
            if (typeof expr.value === 'string') return this.basic('string');
            if (typeof expr.value === 'boolean') return this.basic('bool');
            if (typeof expr.value === 'number') return this.basic('i32');
            return this.basic('object');
        }

        if (expr instanceof IdentifierExpr) {
            const localType = this.lookup(expr.name.lexeme);
            if (localType !== undefined) return localType;
            const fn = this.functions.get(expr.name.lexeme);
            if (fn) return this.functionTypeFromDeclaration(fn);
            return null;
        }

        if (expr instanceof ThisExpr) {
            return this.currentClass ? this.basic(this.currentClass) : null;
        }

        if (expr instanceof GroupingExpr) return this.expressionType(expr.expression);
        if (expr instanceof AsExpr) return expr.type;
        if (expr instanceof UnaryExpr) return this.expressionType(expr.right);
        if (expr instanceof AssignExpr) return this.expressionType(expr.value);

        if (expr instanceof BinaryExpr) {
            switch (expr.operator.type) {
                case TokenType.EQ_EQ:
                case TokenType.BANG_EQ:
                case TokenType.LT:
                case TokenType.LT_EQ:
                case TokenType.GT:
                case TokenType.GT_EQ:
                case TokenType.AMP_AMP:
                case TokenType.PIPE_PIPE:
                    return this.basic('bool');
                default:
                    return this.expressionType(expr.left) ?? this.expressionType(expr.right);
            }
        }

        if (expr instanceof GetExpr) {
            return this.getMemberType(expr);
        }

        if (expr instanceof IndexExpr) {
            const arrayType = this.expressionType(expr.array);
            if (arrayType instanceof ArrayTypeAnnotation) return arrayType.elementType;
            return this.basic('object');
        }

        if (expr instanceof CallExpr) {
            return this.getCallReturnType(expr);
        }

        if (expr instanceof NewExpr) {
            if (expr.callee instanceof IdentifierExpr) {
                const className = expr.callee.name.lexeme;
                if (className === 'Promise') return new PromiseTypeAnnotation(this.basic('object'));
                return this.basic(className);
            }
            return this.basic('object');
        }

        if (expr instanceof FunctionLiteralExpr) {
            return new FunctionTypeAnnotation(
                expr.parameters.map(p => p.type ?? this.basic('object')),
                expr.returnType ?? this.voidType()
            );
        }

        if (expr instanceof ArrayLiteralExpr) {
            const expected = this.currentExpectedType();
            if (expected instanceof ArrayTypeAnnotation) return expected;
            const elementType = expr.elements[0] ? this.expressionType(expr.elements[0]!) : this.basic('object');
            return new ArrayTypeAnnotation(elementType ?? this.basic('object'));
        }

        if (expr instanceof AwaitExpr) {
            const inner = this.expressionType(expr.expression);
            if (inner instanceof PromiseTypeAnnotation) return inner.valueType;
            return this.basic('object');
        }

        return null;
    }

    private getMemberType(expr: GetExpr): TypeAnnotation | null {
        if (expr.object instanceof IdentifierExpr) {
            const ns = this.namespaceImports.get(expr.object.name.lexeme);
            const importedName = ns?.get(expr.name.lexeme);
            if (importedName) {
                const fn = this.functions.get(importedName);
                if (fn) return this.functionTypeFromDeclaration(fn);
                if (this.classes.has(importedName) || this.structs.has(importedName)) return this.basic(importedName);
            }
        }

        const objectType = this.expressionType(expr.object);
        if (objectType instanceof BasicTypeAnnotation) {
            const typeName = objectType.name.lexeme;
            if (typeName === 'string') {
                if (expr.name.lexeme === 'ptr') return new PointerTypeAnnotation(this.basic('char'));
                if (expr.name.lexeme === 'length') return this.basic('i64');
            }
            const classDecl = this.classes.get(typeName);
            if (classDecl) {
                const prop = classDecl.properties.find(p => p.name.lexeme === expr.name.lexeme);
                if (prop) return prop.type;
                const method = classDecl.methods.find(m => m.name.lexeme === expr.name.lexeme);
                if (method) return this.functionTypeFromDeclaration(method);
            }
            const structDecl = this.structs.get(typeName);
            if (structDecl) {
                const prop = structDecl.properties.find(p => p.name.lexeme === expr.name.lexeme);
                if (prop) return prop.type;
            }
        }
        if (objectType instanceof ArrayTypeAnnotation && expr.name.lexeme === 'length') return this.basic('i64');
        return null;
    }

    private getCallReturnType(expr: CallExpr): TypeAnnotation | null {
        if (expr.callee instanceof IdentifierExpr) {
            const fn = this.functions.get(expr.callee.name.lexeme);
            if (fn) return fn.returnType ?? this.voidType();
            const calleeType = this.expressionType(expr.callee);
            if (calleeType instanceof FunctionTypeAnnotation) return calleeType.returnType;
        }

        if (expr.callee instanceof GetExpr) {
            const callee = expr.callee;
            const mapped = this.resolveNamespaceMember(callee);
            if (mapped) {
                const fn = this.functions.get(mapped);
                if (fn) return fn.returnType ?? this.voidType();
            }

            if (callee.object instanceof IdentifierExpr && callee.object.name.lexeme === 'uv') {
                return this.getUvReturnType(callee.name.lexeme);
            }

            const objectType = this.expressionType(callee.object);
            if (objectType instanceof BasicTypeAnnotation) {
                const classDecl = this.classes.get(objectType.name.lexeme);
                const method = classDecl?.methods.find(m => m.name.lexeme === callee.name.lexeme);
                if (method) return method.returnType ?? this.voidType();
            }
        }

        const calleeType = this.expressionType(expr.callee);
        if (calleeType instanceof FunctionTypeAnnotation) return calleeType.returnType;
        return null;
    }

    private getUvReturnType(name: string): TypeAnnotation {
        switch (name) {
            case 'readFileSync': return this.basic('string');
            case 'tcpCreateServer':
            case 'tcpConnect':
                return this.basic('i64');
            case 'readFile':
                return this.voidType();
            default:
                return this.basic('i32');
        }
    }

    private getCallableParameterTypes(callee: Expr): TypeAnnotation[] {
        if (callee instanceof IdentifierExpr) {
            const fn = this.functions.get(callee.name.lexeme);
            if (fn) return fn.parameters.map(p => p.type ?? this.basic('object'));
            const calleeType = this.expressionType(callee);
            if (calleeType instanceof FunctionTypeAnnotation) return calleeType.parameters;
        }

        if (callee instanceof GetExpr) {
            const mapped = this.resolveNamespaceMember(callee);
            if (mapped) {
                const fn = this.functions.get(mapped);
                if (fn) return fn.parameters.map(p => p.type ?? this.basic('object'));
            }

            if (callee.object instanceof IdentifierExpr && callee.object.name.lexeme === 'uv') {
                return this.getUvParameterTypes(callee.name.lexeme);
            }

            const objectType = this.expressionType(callee.object);
            if (objectType instanceof BasicTypeAnnotation) {
                const classDecl = this.classes.get(objectType.name.lexeme);
                const method = classDecl?.methods.find(m => m.name.lexeme === callee.name.lexeme);
                if (method) return method.parameters.map(p => p.type ?? this.basic('object'));
            }
        }

        const calleeType = this.expressionType(callee);
        if (calleeType instanceof FunctionTypeAnnotation) return calleeType.parameters;
        return [];
    }

    private getUvParameterTypes(name: string): TypeAnnotation[] {
        const statusCb = new FunctionTypeAnnotation([this.basic('i32')], this.voidType());
        const socketCb = new FunctionTypeAnnotation([this.basic('i64')], this.voidType());
        const errStringCb = new FunctionTypeAnnotation([this.basic('i32'), this.basic('string')], this.voidType());
        switch (name) {
            case 'readFile': return [this.basic('string'), errStringCb];
            case 'tcpCreateServer': return [socketCb];
            case 'tcpReadStart': return [this.basic('i64'), errStringCb];
            case 'tcpListen': return [this.basic('i64'), this.basic('i32'), this.basic('string'), this.basic('i32'), statusCb];
            case 'tcpConnect': return [this.basic('i32'), this.basic('string'), statusCb];
            case 'tcpWrite': return [this.basic('i64'), this.basic('string'), statusCb];
            case 'tcpShutdown': return [this.basic('i64'), statusCb];
            case 'readFileSync': return [this.basic('string')];
            case 'writeFileSync':
            case 'appendFileSync':
                return [this.basic('string'), this.basic('string')];
            case 'renameSync': return [this.basic('string'), this.basic('string')];
            case 'mkdirSync': return [this.basic('string'), this.basic('i32')];
            case 'tcpClose':
            case 'accessSync':
            case 'unlinkSync':
            case 'rmdirSync':
                return [this.basic('i64')];
            default:
                return [];
        }
    }

    private resolveNamespaceMember(expr: GetExpr): string | null {
        if (!(expr.object instanceof IdentifierExpr)) return null;
        const ns = this.namespaceImports.get(expr.object.name.lexeme);
        return ns?.get(expr.name.lexeme) ?? null;
    }

    visitLiteralExpr(expr: LiteralExpr): string {
        if (typeof expr.value === 'string') return this.yuStringLiteral(expr.value);
        if (typeof expr.value === 'number') return expr.value.toString();
        if (typeof expr.value === 'boolean') return expr.value ? 'true' : 'false';
        return 'nullptr';
    }

    visitIdentifierExpr(expr: IdentifierExpr): string {
        if (this.lookup(expr.name.lexeme) !== undefined) return expr.name.lexeme;
        if (this.functions.has(expr.name.lexeme)) return this.mangleName(expr.name.lexeme);
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
                return `${name}(${expr.args.map(arg => this.renderClibArg(arg)).join(', ')})`;
            }

            if (objExpr instanceof IdentifierExpr && objExpr.name.lexeme === 'uv') {
                return this.renderUvCall(name, expr.args);
            }

            const mapped = this.resolveNamespaceMember(expr.callee);
            if (mapped) {
                const paramTypes = this.getCallableParameterTypes(expr.callee);
                const args = expr.args.map((arg, i) => this.withExpectedType(paramTypes[i], () => arg.accept(this))).join(', ');
                return `${this.mangleName(mapped)}(${args})`;
            }

            const objectType = this.expressionType(objExpr);
            const obj = objExpr.accept(this);
            if (name === 'push') {
                const val = expr.args[0] ? expr.args[0]!.accept(this) : 'nullptr';
                const arrVar = `yu_arr_push_${this.labelCounter++}`;
                return `([&]() -> int64_t { yu_array* ${arrVar} = &${obj}; if (${arrVar}->length >= ${arrVar}->capacity) { ${arrVar}->capacity = ${arrVar}->capacity == 0 ? 4 : ${arrVar}->capacity * 2; ${arrVar}->ptr = GC_realloc(${arrVar}->ptr, ${arrVar}->capacity * sizeof(void*)); } ((void**)${arrVar}->ptr)[${arrVar}->length++] = (void*)(intptr_t)${val}; return ${arrVar}->length; })()`;
            }

            if (objectType instanceof BasicTypeAnnotation) {
                const classDecl = this.classes.get(objectType.name.lexeme);
                const method = classDecl?.methods.find(m => m.name.lexeme === name);
                if (method) {
                    const args = expr.args.map((arg, i) => this.withExpectedType(method.parameters[i]?.type, () => arg.accept(this)));
                    return `yu_class_${objectType.name.lexeme}_${name}(${[obj, ...args].join(', ')})`;
                }
            }

            const paramTypes = this.getCallableParameterTypes(expr.callee);
            const args = expr.args.map((arg, i) => this.withExpectedType(paramTypes[i], () => arg.accept(this))).join(', ');
            return `${expr.callee.accept(this)}(${args})`;
        }

        const paramTypes = this.getCallableParameterTypes(expr.callee);
        const callee = expr.callee.accept(this);
        const args = expr.args.map((arg, i) => this.withExpectedType(paramTypes[i], () => arg.accept(this))).join(', ');
        return `${callee}(${args})`;
    }

    private renderClibArg(arg: Expr): string {
        if (arg instanceof LiteralExpr && typeof arg.value === 'string') {
            return this.rawStringLiteral(arg.value);
        }
        const argType = this.expressionType(arg);
        const value = arg.accept(this);
        if (argType instanceof BasicTypeAnnotation && argType.name.lexeme === 'string') {
            return `${value}.ptr`;
        }
        return value;
    }

    private renderUvCall(name: string, args: Expr[]): string {
        const renderedArgs = args.map((arg, i) => this.withExpectedType(this.getUvParameterTypes(name)[i], () => arg.accept(this)));
        const callbackPair = (arg: string, kind: 'status' | 'i64' | 'err_string') => {
            switch (kind) {
                case 'status': return `(void*)(&yu_cb_status_thunk), yu_cb_status_env(${arg})`;
                case 'i64': return `(void*)(&yu_cb_i64_thunk), yu_cb_i64_env(${arg})`;
                case 'err_string': return `(void*)(&yu_cb_err_string_thunk), yu_cb_err_string_env(${arg})`;
            }
        };

        switch (name) {
            case 'readFile':
                return `yu_fs_readFile(${renderedArgs[0]}, ${callbackPair(renderedArgs[1]!, 'err_string')})`;
            case 'readFileSync':
                return `yu_uv_readFileSync(${renderedArgs.join(', ')})`;
            case 'writeFileSync':
                return `yu_uv_writeFileSync(${renderedArgs.join(', ')})`;
            case 'appendFileSync':
                return `yu_uv_appendFileSync(${renderedArgs.join(', ')})`;
            case 'accessSync':
                return `yu_uv_accessSync(${renderedArgs.join(', ')})`;
            case 'unlinkSync':
                return `yu_uv_unlinkSync(${renderedArgs.join(', ')})`;
            case 'renameSync':
                return `yu_uv_renameSync(${renderedArgs.join(', ')})`;
            case 'mkdirSync':
                return `yu_uv_mkdirSync(${renderedArgs.join(', ')})`;
            case 'rmdirSync':
                return `yu_uv_rmdirSync(${renderedArgs.join(', ')})`;
            case 'tcpCreateServer':
                return `yu_uv_tcpCreateServer(${callbackPair(renderedArgs[0]!, 'i64')})`;
            case 'tcpListen':
                return `yu_uv_tcpListen(${renderedArgs[0]}, ${renderedArgs[1]}, ${renderedArgs[2]}, ${renderedArgs[3]}, ${callbackPair(renderedArgs[4]!, 'status')})`;
            case 'tcpConnect':
                return `yu_uv_tcpConnect(${renderedArgs[0]}, ${renderedArgs[1]}, ${callbackPair(renderedArgs[2]!, 'status')})`;
            case 'tcpReadStart':
                return `yu_uv_tcpReadStart(${renderedArgs[0]}, ${callbackPair(renderedArgs[1]!, 'err_string')})`;
            case 'tcpWrite':
                return `yu_uv_tcpWrite(${renderedArgs[0]}, ${renderedArgs[1]}, ${callbackPair(renderedArgs[2]!, 'status')})`;
            case 'tcpShutdown':
                return `yu_uv_tcpShutdown(${renderedArgs[0]}, ${callbackPair(renderedArgs[1]!, 'status')})`;
            case 'tcpClose':
                return `yu_uv_tcpClose(${renderedArgs.join(', ')})`;
            default:
                return `yu_uv_${name}(${renderedArgs.join(', ')})`;
        }
    }

    visitGetExpr(expr: GetExpr): string {
        if (expr.object instanceof IdentifierExpr && expr.object.name.lexeme === 'clib') return expr.name.lexeme;
        if (expr.object instanceof IdentifierExpr && expr.object.name.lexeme === 'uv') return `yu_uv_${expr.name.lexeme}`;

        const mapped = this.resolveNamespaceMember(expr);
        if (mapped) return this.mangleName(mapped);

        const obj = expr.object.accept(this);
        const objType = this.expressionType(expr.object);
        if (objType instanceof ArrayTypeAnnotation && expr.name.lexeme === 'length') return `${obj}.length`;
        if (objType instanceof BasicTypeAnnotation) {
            if (objType.name.lexeme === 'string' && (expr.name.lexeme === 'ptr' || expr.name.lexeme === 'length')) {
                return `${obj}.${expr.name.lexeme}`;
            }
            if (this.classes.has(objType.name.lexeme)) return `${obj}->${expr.name.lexeme}`;
            if (this.structs.has(objType.name.lexeme)) return `${obj}.${expr.name.lexeme}`;
        }
        return `${obj}.${expr.name.lexeme}`;
    }

    visitIndexExpr(expr: IndexExpr): string {
        const arr = expr.array.accept(this);
        const idx = expr.index.accept(this);
        const arrType = this.expressionType(expr.array);
        const elementType = arrType instanceof ArrayTypeAnnotation ? arrType.elementType : this.basic('object');
        return `((${this.getCppType(elementType)}*)${arr}.ptr)[${idx}]`;
    }

    visitAssignExpr(expr: AssignExpr): string {
        return `${expr.target.accept(this)} = ${this.withExpectedType(this.expressionType(expr.target), () => expr.value.accept(this))}`;
    }

    visitThisExpr(expr: ThisExpr): string {
        return 'self';
    }

    visitAsExpr(expr: AsExpr): string {
        return `(${this.getCppType(expr.type)})(${expr.expression.accept(this)})`;
    }

    visitAwaitExpr(expr: AwaitExpr): string {
        const inner = expr.expression.accept(this);
        const resultType = this.expressionType(expr);
        const promiseVar = `yu_promise_${this.labelCounter++}`;
        if (resultType instanceof BasicTypeAnnotation && resultType.name.lexeme === 'void') {
            return `([&]() -> void { yu_promise* ${promiseVar} = ${inner}; while (!${promiseVar}->resolved) yu_uv_run(); })()`;
        }
        return `([&]() -> ${this.getCppType(resultType)} { yu_promise* ${promiseVar} = ${inner}; while (!${promiseVar}->resolved) yu_uv_run(); return (${this.getCppType(resultType)})${promiseVar}->value; })()`;
    }

    visitObjectLiteralExpr(expr: ObjectLiteralExpr): string {
        return 'nullptr';
    }

    visitNewExpr(expr: NewExpr): string {
        if (expr.callee instanceof IdentifierExpr && expr.callee.name.lexeme === 'Promise') {
            return this.renderPromiseNew(expr);
        }

        if (expr.callee instanceof IdentifierExpr) {
            const className = expr.callee.name.lexeme;
            const classDecl = this.classes.get(className);
            const varName = `yu_new_${this.labelCounter++}`;
            const ctor = classDecl?.methods.find(m => m.name.lexeme === 'init');
            const args = ctor
                ? expr.args.map((arg, i) => this.withExpectedType(ctor.parameters[i]?.type, () => arg.accept(this)))
                : expr.args.map(arg => arg.accept(this));
            let code = `([&]() -> yu_class_${className}* { auto* ${varName} = (yu_class_${className}*)GC_malloc(sizeof(yu_class_${className})); `;
            if (ctor) code += `yu_class_${className}_init(${[varName, ...args].join(', ')}); `;
            code += `return ${varName}; })()`;
            return code;
        }
        return 'nullptr';
    }

    private renderPromiseNew(expr: NewExpr): string {
        const promiseVar = `yu_promise_${this.labelCounter++}`;
        const executor = expr.args[0] ? expr.args[0]!.accept(this) : 'nullptr';
        return `([&]() -> yu_promise* { auto* ${promiseVar} = (yu_promise*)GC_malloc(sizeof(yu_promise)); ${promiseVar}->value = nullptr; ${promiseVar}->resolved = 0; auto resolve = [${promiseVar}](auto value) -> void { ${promiseVar}->value = (void*)value; ${promiseVar}->resolved = 1; }; auto reject = [${promiseVar}](int32_t err) -> void { ${promiseVar}->value = (void*)(intptr_t)err; ${promiseVar}->resolved = 1; }; ${executor}(resolve, reject); return ${promiseVar}; })()`;
    }

    visitDeleteExpr(expr: DeleteExpr): string {
        return '((void)0)';
    }

    visitAddressOfExpr(expr: AddressOfExpr): string {
        return `&(${expr.expression.accept(this)})`;
    }

    visitDereferenceExpr(expr: DereferenceExpr): string {
        return `*(${expr.expression.accept(this)})`;
    }

    visitFunctionLiteralExpr(expr: FunctionLiteralExpr): string {
        const expected = this.currentExpectedType();
        const expectedFn = expected instanceof FunctionTypeAnnotation ? expected : null;
        const returnType = expr.returnType ?? expectedFn?.returnType ?? this.voidType();
        const params = expr.parameters.map((p, i) => {
            const paramType = p.type ?? expectedFn?.parameters[i] ?? this.basic('object');
            return { name: p.name.lexeme, type: paramType };
        });

        this.pushScope();
        for (const param of params) this.define(param.name, param.type);
        const body = expr.body.accept(this);
        this.popScope();

        return `[&](${params.map(p => `${this.getCppType(p.type)} ${p.name}`).join(', ')}) -> ${this.getCppType(returnType)} ${body}`;
    }

    visitArrayLiteralExpr(expr: ArrayLiteralExpr): string {
        const expected = this.currentExpectedType();
        const elementType = expected instanceof ArrayTypeAnnotation
            ? expected.elementType
            : (expr.elements[0] ? this.expressionType(expr.elements[0]!) : this.basic('object')) ?? this.basic('object');
        const arrayVar = `yu_arr_${this.labelCounter++}`;
        const elementCpp = this.getCppType(elementType);
        let code = `([&]() -> yu_array { yu_array ${arrayVar}; ${arrayVar}.length = ${expr.elements.length}; ${arrayVar}.capacity = ${expr.elements.length}; ${arrayVar}.ptr = GC_malloc(sizeof(${elementCpp}) * ${expr.elements.length}); `;
        expr.elements.forEach((element, i) => {
            code += `((${elementCpp}*)${arrayVar}.ptr)[${i}] = ${this.withExpectedType(elementType, () => element.accept(this))}; `;
        });
        code += `return ${arrayVar}; })()`;
        return code;
    }

    visitExpressionStmt(stmt: ExpressionStmt): string {
        return `${this.indent()}${stmt.expression.accept(this)};\n`;
    }

    visitBlockStmt(stmt: BlockStmt): string {
        let code = '{\n';
        this.indentLevel++;
        this.pushScope();
        for (const s of stmt.statements) code += s.accept(this);
        this.popScope();
        this.indentLevel--;
        code += `${this.indent()}}\n`;
        return code;
    }

    visitLetStmt(stmt: LetStmt): string {
        const type = stmt.type ?? (stmt.initializer ? this.expressionType(stmt.initializer) : null);
        this.define(stmt.name.lexeme, type);
        const cppType = this.getCppType(type);
        if (!stmt.initializer) return `${this.indent()}${cppType} ${stmt.name.lexeme}{};\n`;
        const init = this.withExpectedType(type, () => stmt.initializer!.accept(this));
        return `${this.indent()}${cppType} ${stmt.name.lexeme} = ${init};\n`;
    }

    visitConstStmt(stmt: ConstStmt): string {
        const type = stmt.type ?? (stmt.initializer ? this.expressionType(stmt.initializer) : null);
        this.define(stmt.name.lexeme, type);
        const init = stmt.initializer ? ` = ${this.withExpectedType(type, () => stmt.initializer!.accept(this))}` : '';
        return `${this.indent()}const ${this.getCppType(type)} ${stmt.name.lexeme}${init};\n`;
    }

    visitIfStmt(stmt: IfStmt): string {
        let code = `${this.indent()}if (${stmt.condition.accept(this)}) ${stmt.thenBranch.accept(this)}`;
        if (stmt.elseBranch) code += `${this.indent()}else ${stmt.elseBranch.accept(this)}`;
        return code;
    }

    visitWhileStmt(stmt: WhileStmt): string {
        return `${this.indent()}while (${stmt.condition.accept(this)}) ${stmt.body.accept(this)}`;
    }

    visitReturnStmt(stmt: ReturnStmt): string {
        return `${this.indent()}return${stmt.value ? ` ${this.withExpectedType(null, () => stmt.value!.accept(this))}` : ''};\n`;
    }

    visitFunctionDeclaration(decl: FunctionDeclaration): string {
        const name = this.mangleName(decl.name.lexeme);
        this.pushScope();
        for (const p of decl.parameters) this.define(p.name.lexeme, p.type);
        let code = `${this.getCppType(decl.returnType ?? this.voidType())} ${name}(${this.renderParameters(decl.parameters)}) `;
        code += decl.body.accept(this);
        this.popScope();
        return code;
    }

    visitClassDeclaration(decl: ClassDeclaration): string {
        let code = '';
        const previousClass = this.currentClass;
        this.currentClass = decl.name.lexeme;
        for (const m of decl.methods) {
            const params = [`yu_class_${decl.name.lexeme}* self`, ...m.parameters.map(p => `${this.getCppType(p.type)} ${p.name.lexeme}`)];
            this.pushScope();
            this.define('self', this.basic(decl.name.lexeme));
            for (const p of m.parameters) this.define(p.name.lexeme, p.type);
            code += `${this.getCppType(m.returnType ?? this.voidType())} yu_class_${decl.name.lexeme}_${m.name.lexeme}(${params.join(', ')}) `;
            code += m.body.accept(this);
            this.popScope();
        }
        this.currentClass = previousClass;
        return code;
    }

    visitStructDeclaration(decl: StructDeclaration): string {
        return '';
    }

    visitPropertyDeclaration(stmt: PropertyDeclaration): string {
        return '';
    }

    visitImportStmt(stmt: ImportStmt): string {
        return '';
    }

    visitDeclareFunction(decl: DeclareFunction): string {
        return '';
    }

    visitUsingStmt(stmt: UsingStmt): string {
        return '';
    }
}
