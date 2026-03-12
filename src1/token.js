export var TokenType;
(function (TokenType) {
    // Keywords
    TokenType["IMPORT"] = "IMPORT";
    TokenType["FROM"] = "FROM";
    TokenType["USING"] = "USING";
    TokenType["AS"] = "AS";
    TokenType["HEAD"] = "HEAD";
    TokenType["MODULE"] = "MODULE";
    TokenType["LOADDLL"] = "LOADDLL";
    TokenType["FUN"] = "FUN";
    TokenType["EXPORT"] = "EXPORT";
    TokenType["INT"] = "INT";
    TokenType["I32"] = "I32";
    TokenType["I64"] = "I64";
    TokenType["F32"] = "F32";
    TokenType["F64"] = "F64";
    TokenType["BOOL"] = "BOOL";
    TokenType["CHAR"] = "CHAR";
    TokenType["FLOAT"] = "FLOAT";
    TokenType["DOUBLE"] = "DOUBLE";
    TokenType["STRING"] = "STRING";
    TokenType["BIND"] = "BIND";
    TokenType["OFFER"] = "OFFER";
    TokenType["DELETE"] = "DELETE";
    TokenType["LET"] = "LET";
    TokenType["CONST"] = "CONST";
    TokenType["THIS"] = "THIS";
    TokenType["RETURN"] = "RETURN";
    TokenType["SYSCALL"] = "SYSCALL";
    TokenType["ADDROF"] = "ADDROF";
    TokenType["OBJOF"] = "OBJOF";
    TokenType["IF"] = "IF";
    TokenType["ELSE"] = "ELSE";
    TokenType["FOR"] = "FOR";
    TokenType["WHILE"] = "WHILE";
    TokenType["BREAK"] = "BREAK";
    TokenType["CONTINUE"] = "CONTINUE";
    TokenType["DECLARE"] = "DECLARE";
    TokenType["INTERFACE"] = "INTERFACE";
    TokenType["CLASS"] = "CLASS";
    TokenType["STRUCT"] = "STRUCT";
    TokenType["NEW"] = "NEW";
    TokenType["PUBLIC"] = "PUBLIC";
    TokenType["PRIVATE"] = "PRIVATE";
    TokenType["STATIC"] = "STATIC";
    TokenType["ARRAY"] = "ARRAY";
    TokenType["OBJECT"] = "OBJECT";
    TokenType["POINTER"] = "POINTER";
    TokenType["TRUE"] = "TRUE";
    TokenType["FALSE"] = "FALSE";
    // Identifiers
    TokenType["IDENTIFIER"] = "IDENTIFIER";
    // Literals
    TokenType["NUMBER"] = "NUMBER";
    TokenType["STRING_LITERAL"] = "STRING_LITERAL";
    TokenType["CHAR_LITERAL"] = "CHAR_LITERAL";
    // Operators
    TokenType["PLUS"] = "PLUS";
    TokenType["MINUS"] = "MINUS";
    TokenType["STAR"] = "STAR";
    TokenType["SLASH"] = "SLASH";
    TokenType["EQ_EQ"] = "EQ_EQ";
    TokenType["BANG_EQ"] = "BANG_EQ";
    TokenType["LT"] = "LT";
    TokenType["GT"] = "GT";
    TokenType["LT_EQ"] = "LT_EQ";
    TokenType["GT_EQ"] = "GT_EQ";
    TokenType["EQ"] = "EQ";
    TokenType["BANG"] = "BANG";
    TokenType["AMPERSAND"] = "AMPERSAND";
    TokenType["AMP_AMP"] = "AMP_AMP";
    TokenType["PIPE"] = "PIPE";
    TokenType["PIPE_PIPE"] = "PIPE_PIPE";
    TokenType["CARET"] = "CARET";
    TokenType["PERCENT"] = "PERCENT";
    TokenType["LT_LT"] = "LT_LT";
    TokenType["GT_GT"] = "GT_GT";
    TokenType["ARROW"] = "ARROW";
    // Delimiters/Punctuators
    TokenType["LPAREN"] = "LPAREN";
    TokenType["RPAREN"] = "RPAREN";
    TokenType["LBRACE"] = "LBRACE";
    TokenType["RBRACE"] = "RBRACE";
    TokenType["LBRACKET"] = "LBRACKET";
    TokenType["RBRACKET"] = "RBRACKET";
    TokenType["COMMA"] = "COMMA";
    TokenType["SEMICOLON"] = "SEMICOLON";
    TokenType["COLON"] = "COLON";
    TokenType["DOT"] = "DOT";
    TokenType["HASH"] = "HASH";
    // Special
    TokenType["EOF"] = "EOF";
    TokenType["UNKNOWN"] = "UNKNOWN";
})(TokenType || (TokenType = {}));
export class Token {
    type;
    lexeme;
    literal;
    line;
    column;
    constructor(type, lexeme, literal, line, column) {
        this.type = type;
        this.lexeme = lexeme;
        this.literal = literal;
        this.line = line;
        this.column = column;
    }
    toString() {
        return `[${this.line}:${this.column}] ${this.type} ${this.lexeme} ${this.literal || ''}`;
    }
}
// Map of keywords for quick lookup (use null-prototype object to avoid inheriting 'constructor')
export const keywords = Object.create(null);
Object.assign(keywords, {
    // Preprocessor Directives
    '#import': TokenType.IMPORT,
    'from': TokenType.FROM,
    '#using': TokenType.USING,
    // Keywords
    'as': TokenType.AS,
    'head': TokenType.HEAD,
    'module': TokenType.MODULE,
    'LoadDLL': TokenType.LOADDLL,
    'fun': TokenType.FUN,
    'export': TokenType.EXPORT,
    // Preferred primitive type keywords
    'i32': TokenType.I32,
    'i64': TokenType.I64,
    'f32': TokenType.F32,
    'f64': TokenType.F64,
    'bool': TokenType.BOOL,
    'char': TokenType.CHAR,
    'string': TokenType.STRING,
    'bind': TokenType.BIND,
    'offer': TokenType.OFFER,
    'delete': TokenType.DELETE,
    'let': TokenType.LET,
    'const': TokenType.CONST,
    'this': TokenType.THIS,
    'return': TokenType.RETURN,
    'syscall': TokenType.SYSCALL,
    'addrof': TokenType.ADDROF,
    'objof': TokenType.OBJOF,
    'if': TokenType.IF,
    'else': TokenType.ELSE,
    'for': TokenType.FOR,
    'while': TokenType.WHILE,
    'break': TokenType.BREAK,
    'continue': TokenType.CONTINUE,
    'declare': TokenType.DECLARE,
    'interface': TokenType.INTERFACE,
    'class': TokenType.CLASS,
    'struct': TokenType.STRUCT, // NEW
    'new': TokenType.NEW,
    'public': TokenType.PUBLIC,
    'private': TokenType.PRIVATE,
    'static': TokenType.STATIC,
    'array': TokenType.ARRAY,
    'object': TokenType.OBJECT, // NEW
    'pointer': TokenType.POINTER,
    'true': TokenType.TRUE, // NEW
    'false': TokenType.FALSE, // NEW
});
//# sourceMappingURL=token.js.map