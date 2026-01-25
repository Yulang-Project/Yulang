import { Token, TokenType, keywords } from './token.js';

export class Lexer {
    private source: string;
    private tokens: Token[] = [];
    private start = 0;
    private current = 0;
    private line = 1;
    private column = 1;

    constructor(source: string) {
        this.source = source;
    }

    tokenize(): Token[] {
        while (!this.isAtEnd()) {
            this.start = this.current;
            this.scanToken();
        }

        this.tokens.push(new Token(TokenType.EOF, "", null, this.line, this.column));
        return this.tokens;
    }

    private isAtEnd(): boolean {
        return this.current >= this.source.length;
    }

    private advance(): string {
        const char = this.source.charAt(this.current);
        this.current++;
        this.column++;
        return char;
    }

    private addToken(type: TokenType, literal: any = null): void {
        const text = this.source.substring(this.start, this.current);
        this.tokens.push(new Token(type, text, literal, this.line, this.column - text.length));
    }

    private match(expected: string): boolean {
        if (this.isAtEnd()) return false;
        if (this.source.charAt(this.current) !== expected) return false;

        this.current++;
        this.column++;
        return true;
    }

    private peek(): string {
        if (this.isAtEnd()) return '\0'; // Null character
        return this.source.charAt(this.current);
    }

    private peekNext(): string {
        if (this.current + 1 >= this.source.length) return '\0';
        return this.source.charAt(this.current + 1);
    }

    private isDigit(char: string): boolean {
        return char >= '0' && char <= '9';
    }

    private isAlpha(char: string): boolean {
        return (char >= 'a' && char <= 'z') ||
               (char >= 'A' && char <= 'Z') ||
               char === '_';
    }

    private isAlphaNumeric(char: string): boolean {
        return this.isAlpha(char) || this.isDigit(char);
    }

    private number(): void {
        while (this.isDigit(this.peek())) this.advance();

        if (this.peek() === '.' && this.isDigit(this.peekNext())) {
            this.advance();
            while (this.isDigit(this.peek())) this.advance();
        }

        this.addToken(TokenType.NUMBER, parseFloat(this.source.substring(this.start, this.current)));
    }

    private string(): void {
        let value = "";
        while (this.peek() !== '"' && !this.isAtEnd()) {
            const ch = this.advance();
            if (ch === '\\') {
                const esc = this.peek();
                switch (esc) {
                    case 'n': value += '\n'; this.advance(); break;
                    case 't': value += '\t'; this.advance(); break;
                    case 'r': value += '\r'; this.advance(); break;
                    case '\\': value += '\\'; this.advance(); break;
                    case '"': value += '"'; this.advance(); break;
                    case '0': value += '\0'; this.advance(); break;
                    default: value += esc; this.advance(); break;
                }
            } else {
                if (ch === '\n') { this.line++; this.column = 0; }
                value += ch;
            }
        }

        if (this.isAtEnd()) {
            return;
        }

        this.advance(); // closing quote
        this.addToken(TokenType.STRING_LITERAL, value);
    }

    private char(): void {
        if (this.isAtEnd()) { // Check for unclosed char literal before consuming
            // Error handling will be done in parser for now
            return;
        }

        const charValue = this.advance(); // Read the character inside the quotes

        if (this.isAtEnd()) { // Check for unclosed char literal after consuming
            // Error handling will be done in parser for now
            return;
        }

        if (this.peek() !== "'") {
            // Error handling will be done in parser for now
            while (this.peek() !== "'" && this.peek() !== '\n' && !this.isAtEnd()) {
                this.advance();
            }
            if (this.peek() === "'") { // If we found a closing quote, consume it
                this.advance();
            }
        } else {
            this.advance(); // Consume the closing quote
        }

        this.addToken(TokenType.CHAR_LITERAL, charValue.charCodeAt(0)); // Store ASCII value
    }

    private identifierOrKeyword(): void {
        // Handle '#' as part of keywords like #import
        if (this.source.charAt(this.start) === '#') {
            this.advance(); // consume '#'
        }

        while (this.isAlphaNumeric(this.peek())) {
            this.advance();
        }

        const text = this.source.substring(this.start, this.current);
        const tokenType = keywords[text];

        if (tokenType) {
            this.addToken(tokenType);
        } else if (text.startsWith('#')) {
             this.addToken(TokenType.UNKNOWN, "Unrecognized preprocessor directive");
        }
        else {
            this.addToken(TokenType.IDENTIFIER);
        }
    }


    private scanToken(): void {
        const char = this.advance();

        switch (char) {
            case '(': this.addToken(TokenType.LPAREN); break;
            case ')': this.addToken(TokenType.RPAREN); break;
            case '{': this.addToken(TokenType.LBRACE); break;
            case '}': this.addToken(TokenType.RBRACE); break;
            case '[': this.addToken(TokenType.LBRACKET); break;
            case ']': this.addToken(TokenType.RBRACKET); break;
            case ',': this.addToken(TokenType.COMMA); break;
            case '.': this.addToken(TokenType.DOT); break;
            case ';': this.addToken(TokenType.SEMICOLON); break;
            case ':': this.addToken(TokenType.COLON); break;

            case '+': this.addToken(TokenType.PLUS); break;
            case '*': this.addToken(TokenType.STAR); break;
            case '%': this.addToken(TokenType.PERCENT); break; // Add PERCENT
            case '/':
                if (this.match('/')) {
                    // A single-line comment goes until the end of the line.
                    while (this.peek() !== '\n' && !this.isAtEnd()) this.advance();
                } else if (this.match('*')) {
                    while (!(this.peek() === '*' && this.peekNext() === '/') && !this.isAtEnd()) {
                        if (this.peek() === '\n') {
                            this.line++;
                            this.column = 1; // Reset column on new line
                        }
                        this.advance();
                    }

                    if (this.isAtEnd()) {
                        this.addToken(TokenType.UNKNOWN, "Unclosed multi-line comment");
                    } else {
                        this.advance(); // consume '*'
                        this.advance(); // consume '/'
                    }
                }
                else {
                    this.addToken(TokenType.SLASH);
                }
                break;

            case '-':
                this.addToken(this.match('>') ? TokenType.ARROW : TokenType.MINUS);
                break;
            case '=':
                this.addToken(this.match('=') ? TokenType.EQ_EQ : TokenType.EQ);
                break;
            case '!':
                this.addToken(this.match('=') ? TokenType.BANG_EQ : TokenType.BANG);
                break;
            case '<':
                if (this.match('<')) {
                    this.addToken(TokenType.LT_LT); // Add LT_LT
                } else {
                    this.addToken(this.match('=') ? TokenType.LT_EQ : TokenType.LT);
                }
                break;
            case '>':
                if (this.match('>')) {
                    this.addToken(TokenType.GT_GT); // Add GT_GT
                } else {
                    this.addToken(this.match('=') ? TokenType.GT_EQ : TokenType.GT);
                }
                break;
            case '^': this.addToken(TokenType.CARET); break; // Add CARET

            case '&':
                if (this.match('&')) {
                    this.addToken(TokenType.AMP_AMP);
                } else {
                    this.addToken(TokenType.AMPERSAND);
                }
                break;
            case '|':
                if (this.match('|')) {
                    this.addToken(TokenType.PIPE_PIPE);
                } else {
                    this.addToken(TokenType.PIPE); // Single | for bitwise OR
                }
                break;

            case '"': this.string(); break;
            case "'": this.char(); break;

            // Whitespace
            case ' ':
            case '\r':
            case '\t':
                // Ignore whitespace
                break;

            case '\n':
                this.line++;
                this.column = 1;
                break;
            
            case '#':
                // It's a preprocessor directive, which is handled as an identifier
                this.identifierOrKeyword();
                break;

            default:
                if (this.isDigit(char)) {
                    this.number();
                } else if (this.isAlpha(char)) {
                    this.identifierOrKeyword();
                } else {
                    this.addToken(TokenType.UNKNOWN, `Unexpected character: ${char}`);
                }
                break;
        }
    }
}
