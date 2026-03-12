import type { IRGenerator, IRValue } from '../generator/ir_generator.js';

export type PredefinedFunctionHandler = (generator: IRGenerator, evaluatedArgs: IRValue[]) => IRValue;

export interface PredefinedFunction {
    name: string;
    handler: PredefinedFunctionHandler;
}
