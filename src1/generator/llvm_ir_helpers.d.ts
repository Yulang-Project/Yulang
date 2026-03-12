import { TypeAnnotation } from "../ast.js";
import type { IRValue } from "./ir_generator.js";
import type { LLVMContextRef, LLVMTypeRef, LLVMValueRef } from "../llvm/index.js";
type GlobalStringEntry = {
    charPtrGlobal: LLVMValueRef;
    stringStructGlobal: LLVMValueRef;
    charArrayType: LLVMTypeRef;
    length: number;
};
export declare class LLVMIRHelper {
    private context;
    private stringConstantCounter;
    private stringStructConstantCounter;
    private globalStringStructs;
    private generator;
    private namedStructs;
    constructor();
    getContext(): LLVMContextRef;
    setGenerator(gen: any): void;
    getGenerator(): any;
    getTargetTriple(): string;
    getDataLayout(): string;
    createGlobalString(value: string): GlobalStringEntry;
    getLLVMType(typeAnnotation: TypeAnnotation | null): LLVMTypeRef;
    getNewTempVar(): string;
    getNewUniqueName(prefix: string): string;
    getAlign(llvmType: LLVMTypeRef): number;
    sizeOf(llvmType: LLVMTypeRef): number;
    getPointerType(type: LLVMTypeRef): LLVMTypeRef;
    bitcast(value: IRValue, targetType: LLVMTypeRef): IRValue;
    getLLVMTypeByName(name: string): LLVMTypeRef;
    ensureArrayStructDefinition(elementType: LLVMTypeRef): LLVMTypeRef;
}
export {};
//# sourceMappingURL=llvm_ir_helpers.d.ts.map