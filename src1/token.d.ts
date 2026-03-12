export declare enum TokenType {
    IMPORT = "IMPORT",
    FROM = "FROM",
    USING = "USING",
    AS = "AS",
    HEAD = "HEAD",
    MODULE = "MODULE",
    LOADDLL = "LOADDLL",
    FUN = "FUN",
    EXPORT = "EXPORT",
    INT = "INT",
    I32 = "I32",
    I64 = "I64",
    F32 = "F32",
    F64 = "F64",
    BOOL = "BOOL",
    CHAR = "CHAR",
    FLOAT = "FLOAT",
    DOUBLE = "DOUBLE",
    STRING = "STRING",
    BIND = "BIND",
    OFFER = "OFFER",
    DELETE = "DELETE",
    LET = "LET",
    CONST = "CONST",
    THIS = "THIS",
    RETURN = "RETURN",
    SYSCALL = "SYSCALL",
    ADDROF = "ADDROF",
    OBJOF = "OBJOF",
    IF = "IF",
    ELSE = "ELSE",
    FOR = "FOR",
    WHILE = "WHILE",
    BREAK = "BREAK",
    CONTINUE = "CONTINUE",
    DECLARE = "DECLARE",
    INTERFACE = "INTERFACE",
    CLASS = "CLASS",
    STRUCT = "STRUCT",
    NEW = "NEW",
    PUBLIC = "PUBLIC",
    PRIVATE = "PRIVATE",
    STATIC = "STATIC",
    ARRAY = "ARRAY",// NEW: Add ARRAY token
    OBJECT = "OBJECT",// NEW: Add OBJECT token
    POINTER = "POINTER",// NEW: Add POINTER token
    TRUE = "TRUE",// NEW: Add TRUE token
    FALSE = "FALSE",// NEW: Add FALSE token
    IDENTIFIER = "IDENTIFIER",
    NUMBER = "NUMBER",
    STRING_LITERAL = "STRING_LITERAL",
    CHAR_LITERAL = "CHAR_LITERAL",// New: Character literal
    PLUS = "PLUS",
    MINUS = "MINUS",
    STAR = "STAR",
    SLASH = "SLASH",
    EQ_EQ = "EQ_EQ",// ==
    BANG_EQ = "BANG_EQ",// !=
    LT = "LT",// <
    GT = "GT",// >
    LT_EQ = "LT_EQ",// <=
    GT_EQ = "GT_EQ",// >=
    EQ = "EQ",// =
    BANG = "BANG",// !
    AMPERSAND = "AMPERSAND",// &
    AMP_AMP = "AMP_AMP",// &&
    PIPE = "PIPE",// | (NEW)
    PIPE_PIPE = "PIPE_PIPE",// ||
    CARET = "CARET",// ^ (新增)
    PERCENT = "PERCENT",// % (新增)
    LT_LT = "LT_LT",// << (新增)
    GT_GT = "GT_GT",// >> (新增)
    ARROW = "ARROW",// -> (legacy, no longer used for pointer init)
    LPAREN = "LPAREN",// (
    RPAREN = "RPAREN",// )
    LBRACE = "LBRACE",// {
    RBRACE = "RBRACE",// }
    LBRACKET = "LBRACKET",// [
    RBRACKET = "RBRACKET",// ]
    COMMA = "COMMA",// ,
    SEMICOLON = "SEMICOLON",// ;
    COLON = "COLON",// :
    DOT = "DOT",// .
    HASH = "HASH",// #
    EOF = "EOF",// End of File
    UNKNOWN = "UNKNOWN"
}
export declare class Token {
    type: TokenType;
    lexeme: string;
    literal: any;
    line: number;
    column: number;
    constructor(type: TokenType, lexeme: string, literal: any, line: number, column: number);
    toString(): string;
}
export declare const keywords: {
    [key: string]: TokenType;
};
//# sourceMappingURL=token.d.ts.map