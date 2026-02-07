// src/generator/ir_generator.ts
// This file re-exports IRGenerator from the irgen directory.

export { IRGenerator } from './irgen/ir_generator_base.js';
export type { IRValue } from './irgen/types_scopes.js'; // Re-export IRValue as it's a common type.