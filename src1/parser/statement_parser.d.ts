import { Stmt, BlockStmt } from '../ast.js';
import { Parser } from './index.js';
export declare class StatementParser {
    private parser;
    constructor(parser: Parser);
    statement(): Stmt;
    private forStatement;
    private returnStatement;
    private ifStatement;
    private whileStatement;
    block(): BlockStmt;
    private expressionStatement;
}
//# sourceMappingURL=statement_parser.d.ts.map