export enum TokenType {
    // Keywords
    IMPORT = 'IMPORT',
    FROM = 'FROM',
    AS = 'AS',
    MODULE = 'MODULE',
    FUN = 'FUN',
    PROMISE = 'PROMISE',
    EXPORT = 'EXPORT',
    I8 = 'I8',
    I16 = 'I16',
    I32 = 'I32',
    I64 = 'I64',
    U8 = 'U8',
    U16 = 'U16',
    U32 = 'U32',
    U64 = 'U64',
    F32 = 'F32',
    F64 = 'F64',
    BOOL = 'BOOL',
    CHAR = 'CHAR',
    STRING = 'STRING',
    DELETE = 'DELETE',
    LET = 'LET',
    CONST = 'CONST',
    THIS = 'THIS',
    RETURN = 'RETURN',
    AWAIT = 'AWAIT',
    IF = 'IF',
    ELSE = 'ELSE',
    FOR = 'FOR',
    WHILE = 'WHILE',
    BREAK = 'BREAK',
    CONTINUE = 'CONTINUE',
    DECLARE = 'DECLARE',
    CLASS = 'CLASS',
    STRUCT = 'STRUCT',
    NEW = 'NEW',
    PUBLIC = 'PUBLIC',
    PRIVATE = 'PRIVATE',
    STATIC = 'STATIC',
    ARRAY = 'ARRAY',
    OBJECT = 'OBJECT',
    TRUE = 'TRUE',
    FALSE = 'FALSE',
    EXTENDS = 'EXTENDS',

    // Identifiers
    IDENTIFIER = 'IDENTIFIER',

    // Literals
    NUMBER = 'NUMBER',
    STRING_LITERAL = 'STRING_LITERAL',
    CHAR_LITERAL = 'CHAR_LITERAL',

    // Operators
    PLUS = 'PLUS',
    MINUS = 'MINUS',
    STAR = 'STAR',
    SLASH = 'SLASH',
    EQ_EQ = 'EQ_EQ', // ==
    ARROW = 'ARROW', // =>
    BANG_EQ = 'BANG_EQ', // !=
    LT = 'LT', // <
    GT = 'GT', // >
    LT_EQ = 'LT_EQ', // <=
    GT_EQ = 'GT_EQ', // >=
    EQ = 'EQ', // =
    BANG = 'BANG', // !
    AMPERSAND = 'AMPERSAND', // &
    AMP_AMP = 'AMP_AMP', // &&
    PIPE = 'PIPE', // |
    PIPE_PIPE = 'PIPE_PIPE', // ||
    CARET = 'CARET',
    PERCENT = 'PERCENT',
    LT_LT = 'LT_LT',
    GT_GT = 'GT_GT',

    // Delimiters/Punctuators
    LPAREN = 'LPAREN', // (
    RPAREN = 'RPAREN', // )
    LBRACE = 'LBRACE', // {
    RBRACE = 'RBRACE', // }
    LBRACKET = 'LBRACKET', // [
    RBRACKET = 'RBRACKET', // ]
    COMMA = 'COMMA', // ,
    SEMICOLON = 'SEMICOLON', // ;
    COLON = 'COLON', // :
    DOT = 'DOT', // .

    // Special
    EOF = 'EOF',
    UNKNOWN = 'UNKNOWN',
}

export class Token {
    constructor(
        public type: TokenType,
        public lexeme: string,
        public literal: any,
        public line: number,
        public column: number
    ) {}

    toString(): string {
        return `[${this.line}:${this.column}] ${this.type} ${this.lexeme} ${this.literal || ''}`;
    }
}

// Map of keywords for quick lookup
export const keywords: { [key: string]: TokenType } = Object.create(null);

Object.assign(keywords, {
    'import': TokenType.IMPORT,
    'from': TokenType.FROM,
    'as': TokenType.AS,
    'module': TokenType.MODULE,
    'fun': TokenType.FUN,
    'function': TokenType.FUN,
    'Promise': TokenType.PROMISE,
    'export': TokenType.EXPORT,
    'i8': TokenType.I8,
    'i16': TokenType.I16,
    'i32': TokenType.I32,
    'i64': TokenType.I64,
    'u8': TokenType.U8,
    'u16': TokenType.U16,
    'u32': TokenType.U32,
    'u64': TokenType.U64,
    'f32': TokenType.F32,
    'f64': TokenType.F64,
    'bool': TokenType.BOOL,
    'char': TokenType.CHAR,
    'string': TokenType.STRING,
    'delete': TokenType.DELETE,
    'let': TokenType.LET,
    'const': TokenType.CONST,
    'this': TokenType.THIS,
    'return': TokenType.RETURN,
    'await': TokenType.AWAIT,
    'if': TokenType.IF,
    'else': TokenType.ELSE,
    'for': TokenType.FOR,
    'while': TokenType.WHILE,
    'break': TokenType.BREAK,
    'continue': TokenType.CONTINUE,
    'declare': TokenType.DECLARE,
    'class': TokenType.CLASS,
    'struct': TokenType.STRUCT,
    'new': TokenType.NEW,
    'public': TokenType.PUBLIC,
    'private': TokenType.PRIVATE,
    'static': TokenType.STATIC,
    'array': TokenType.ARRAY,
    'object': TokenType.OBJECT,
    'true': TokenType.TRUE,
    'false': TokenType.FALSE,
    'extends': TokenType.EXTENDS,
});
