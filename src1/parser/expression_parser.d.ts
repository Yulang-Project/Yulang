import { Expr } from '../ast.js';
import { Parser } from './index.js';
export declare class ExpressionParser {
    private parser;
    constructor(parser: Parser);
    parse(): Expr;
    private assignment;
    private logicOr;
    private logicAnd;
    private equality;
    private bitwiseOr;
    private bitwiseXor;
    private bitwiseAnd;
    private shift;
    private comparison;
    private term;
    private factor;
    private unary;
    private call;
    private finishCall;
    private collectArgs;
    private primary;
}
//# sourceMappingURL=expression_parser.d.ts.map