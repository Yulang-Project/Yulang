export enum TokenType {
    // Keywords
    IMPORT = 'IMPORT',
    FROM = 'FROM',
    USING = 'USING',
    AS = 'AS',
    HEAD = 'HEAD',
    MODULE = 'MODULE',
    LOADDLL = 'LOADDLL',
    FUN = 'FUN',
    EXPORT = 'EXPORT',
    INT = 'INT',
    BOOL = 'BOOL',
    CHAR = 'CHAR',
    FLOAT = 'FLOAT',
    DOUBLE = 'DOUBLE',
    STRING = 'STRING',
    BIND = 'BIND',
    OFFER = 'OFFER',
    DELETE = 'DELETE',
    LET = 'LET',
    CONST = 'CONST',
    THIS = 'THIS',
    RETURN = 'RETURN',
    SYSCALL = 'SYSCALL',
    ADDROF = 'ADDROF',
    OBJOF = 'OBJOF',
    IF = 'IF',
    ELSE = 'ELSE',
    FOR = 'FOR',
    WHILE = 'WHILE',
    BREAK = 'BREAK',
    CONTINUE = 'CONTINUE',
    DECLARE = 'DECLARE',
    INTERFACE = 'INTERFACE',
    CLASS = 'CLASS',
    STRUCT = 'STRUCT',
    NEW = 'NEW',
    PUBLIC = 'PUBLIC',
    PRIVATE = 'PRIVATE',
    ARRAY = 'ARRAY', // NEW: Add ARRAY token
    OBJECT = 'OBJECT', // NEW: Add OBJECT token

    // Identifiers
    IDENTIFIER = 'IDENTIFIER',

    // Literals
    NUMBER = 'NUMBER',
    STRING_LITERAL = 'STRING_LITERAL',
    CHAR_LITERAL = 'CHAR_LITERAL', // New: Character literal

    // Operators
    PLUS = 'PLUS',
    MINUS = 'MINUS',
    STAR = 'STAR',
    SLASH = 'SLASH',
    EQ_EQ = 'EQ_EQ', // ==
    BANG_EQ = 'BANG_EQ', // !=
    LT = 'LT', // <
    GT = 'GT', // >
    LT_EQ = 'LT_EQ', // <=
    GT_EQ = 'GT_EQ', // >=
    EQ = 'EQ', // =
    BANG = 'BANG', // !
    AMP_AMP = 'AMP_AMP', // &&
    PIPE = 'PIPE', // | (NEW)
    PIPE_PIPE = 'PIPE_PIPE', // ||
    ARROW = 'ARROW', // -> (legacy, no longer used for pointer init)

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
    HASH = 'HASH', // #

    // Special
    EOF = 'EOF', // End of File
    UNKNOWN = 'UNKNOWN', // For unrecognized characters
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

// Map of keywords for quick lookup (use null-prototype object to avoid inheriting 'constructor')
export const keywords: { [key: string]: TokenType } = Object.create(null);

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
    'int': TokenType.INT,
    'bool': TokenType.BOOL,
    'char': TokenType.CHAR,
    'float': TokenType.FLOAT,
    'double': TokenType.DOUBLE,
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
    'array': TokenType.ARRAY,
    'object': TokenType.OBJECT, // NEW
});
