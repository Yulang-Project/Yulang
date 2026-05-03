// src/generator/llvm_ir_helpers.ts

import { ASTNode, BasicTypeAnnotation, ArrayTypeAnnotation, TypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation, PromiseTypeAnnotation } from "../ast.js";
import { Token, TokenType } from "../token.js";
import { resolveLangItemType } from "./builtins.js";
import { LangItems } from "./lang_items.js";
import type { IRValue } from "./ir_generator.js";
import { LLVM } from "../llvm/index.js";
import type { LLVMContextRef, LLVMTypeRef, LLVMValueRef } from "../llvm/index.js";

type GlobalStringEntry = {
    charPtrGlobal: LLVMValueRef; // Global for the char array
    stringStructGlobal: LLVMValueRef; // Global for the %struct.String
    charArrayType: LLVMTypeRef;
    length: number;
};

export class LLVMIRHelper {
    private context: LLVMContextRef;
    private stringConstantCounter = 0;
    private stringStructConstantCounter = 0;
    private globalStringStructs: { [key: string]: GlobalStringEntry } = {};
    private generator: any;

    private namedStructs: Map<string, LLVMTypeRef> = new Map();
    private arrayStructs: Map<LLVMTypeRef, LLVMTypeRef> = new Map();
    private arrayElementTypes: Map<LLVMTypeRef, LLVMTypeRef> = new Map();
    private functionStructs: Map<string, LLVMTypeRef> = new Map();
    private closureFunctionTypes: Map<LLVMTypeRef, LLVMTypeRef> = new Map();
    private promiseValueTypes: Map<LLVMTypeRef, LLVMTypeRef> = new Map();
    private promiseStructTypes: Map<LLVMTypeRef, LLVMTypeRef> = new Map();

    constructor() {
        this.context = LLVM.ContextCreate();
    }

    public getContext(): LLVMContextRef {
        return this.context;
    }

    public setGenerator(gen: any) {
        this.generator = gen;
    }

    public getGenerator(): any {
        return this.generator;
    }

    public getTargetTriple(): string {
        return this.generator.platform.architecture.getTargetTriple();
    }

    public getDataLayout(): string {
        return this.generator.platform.architecture.getDataLayout();
    }

    public createGlobalString(value: string): GlobalStringEntry {
        if (this.globalStringStructs[value]) {
            return this.globalStringStructs[value];
        }

        const module = this.generator.getModule();
        
        // 1. Create the char array global
        const charArray = LLVM.ConstStringInContext(this.context, value, value.length, 0);
        const charArrayType = LLVM.ArrayType(LLVM.Int8TypeInContext(this.context), value.length + 1);
        const charPtrGlobal = LLVM.AddGlobal(module, charArrayType, `.str.${this.stringConstantCounter++}`);
        LLVM.SetInitializer(charPtrGlobal, charArray);
        LLVM.SetGlobalConstant(charPtrGlobal, 1);

        // 2. Create the %struct.String global
        const stringStructGlobalName = `.string.${this.stringStructConstantCounter++}`;
        const llvmStringType = this.getLLVMTypeByName(LangItems.string.structName);
        
        // Get the i8* pointer to the start of the char array
        const zero = LLVM.ConstInt(LLVM.Int32TypeInContext(this.context), 0, 0);
        const indices = [zero, zero];
        const charPtrValue = LLVM.ConstInBoundsGEP2(charArrayType, charPtrGlobal, indices, 2);
        
        const stringStructVal = LLVM.ConstStructInContext(this.context, [
            charPtrValue,
            LLVM.ConstInt(LLVM.Int64TypeInContext(this.context), BigInt(value.length) as any, 0)
        ], 2, 0);

        const stringStructGlobal = LLVM.AddGlobal(module, llvmStringType, stringStructGlobalName);
        LLVM.SetInitializer(stringStructGlobal, stringStructVal);
        LLVM.SetGlobalConstant(stringStructGlobal, 1);

        const entry: GlobalStringEntry = {
            charPtrGlobal,
            stringStructGlobal,
            charArrayType,
            length: value.length,
        };
        this.globalStringStructs[value] = entry;

        return entry;
    }

    public getLLVMType(typeAnnotation: TypeAnnotation | null): LLVMTypeRef {
        if (!typeAnnotation) return LLVM.VoidTypeInContext(this.context);

        if (typeAnnotation instanceof PointerTypeAnnotation) {
            return LLVM.PointerType(this.getLLVMType(typeAnnotation.baseType), 0);
        }

        if (typeAnnotation instanceof FunctionTypeAnnotation) {
            const key = this.getFunctionTypeKey(typeAnnotation);
            const existing = this.functionStructs.get(key);
            if (existing) return existing;

            const paramTypes = typeAnnotation.parameters.map(p => this.getLLVMType(p));
            const returnType = this.getLLVMType(typeAnnotation.returnType);
            
            // The actual function pointer signature: return_type (env_ptr, args...)
            const i8PtrType = LLVM.PointerType(LLVM.Int8TypeInContext(this.context), 0);
            const paramsWithEnv = [i8PtrType, ...paramTypes];
            const funcType = LLVM.FunctionType(returnType, paramsWithEnv, paramsWithEnv.length, 0);
            const funcPtrType = LLVM.PointerType(funcType, 0);

            // Represent closures as a struct: { code_ptr, env_ptr }
            const structElements = [funcPtrType, i8PtrType];
            const closureType = LLVM.StructTypeInContext(this.context, structElements, structElements.length, 0);
            this.functionStructs.set(key, closureType);
            this.closureFunctionTypes.set(closureType, funcType);
            return closureType;
        }

        if (typeAnnotation instanceof PromiseTypeAnnotation) {
            const valueType = this.getLLVMType(typeAnnotation.valueType);
            const key = `promise:${this.getTypeKey(typeAnnotation.valueType)}`;
            const promiseStructKey = `${key}:struct`;
            const existingPointer = this.namedStructs.get(key);
            if (existingPointer) return existingPointer;
            const existingStruct = this.namedStructs.get(promiseStructKey);
            const promiseStructType = existingStruct ?? LLVM.StructCreateNamed(this.context, promiseStructKey);
            if (!existingStruct) {
                LLVM.StructSetBody(promiseStructType, [
                    valueType,
                    LLVM.Int32TypeInContext(this.context)
                ], 2, 0);
                this.namedStructs.set(promiseStructKey, promiseStructType);
            }
            const promiseType = LLVM.PointerType(promiseStructType, 0);
            this.namedStructs.set(key, promiseType);
            this.promiseValueTypes.set(promiseType, valueType);
            this.promiseValueTypes.set(promiseStructType, valueType);
            this.promiseStructTypes.set(promiseType, promiseStructType);
            return promiseType;
        }

        if (typeAnnotation instanceof ArrayTypeAnnotation) {
            const elementType = this.getLLVMType(typeAnnotation.elementType);
            return this.ensureArrayStructDefinition(elementType);
        }

        if (typeAnnotation instanceof BasicTypeAnnotation) {
            const typeName = typeAnnotation.name.lexeme;

            const resolvedLangItem = resolveLangItemType(typeName);
            if (resolvedLangItem) {
                return this.getLLVMTypeByName(resolvedLangItem);
            }
            
            switch (typeName) {
                case 'int':
                case 'i64':
                    return LLVM.Int64TypeInContext(this.context);
                case 'i32':
                    return LLVM.Int32TypeInContext(this.context);
                case 'f32':
                    return LLVM.FloatTypeInContext(this.context);
                case 'f64':
                    return LLVM.DoubleTypeInContext(this.context);
                case 'i16':
                    return LLVM.Int16TypeInContext(this.context);
                case 'bool':
                    return LLVM.Int1TypeInContext(this.context);
                case 'char':
                    return LLVM.Int8TypeInContext(this.context);
                case 'void':
                    return LLVM.VoidTypeInContext(this.context);
            }
            
            return this.getLLVMTypeByName(`struct.${typeName}`);
        }
        
        return LLVM.VoidTypeInContext(this.context);
    }

    public getNewTempVar(): string {
        return ""; // LLVM C API will auto-generate if name is empty
    }

    public getNewUniqueName(prefix: string): string {
        return `${prefix}.${this.stringConstantCounter++}`;
    }

    public getAlign(llvmType: LLVMTypeRef): number {
        // This is now less useful since LLVM handles it, but kept for compatibility
        return 8;
    }

    public sizeOf(llvmType: LLVMTypeRef): number {
        return 8;
    }

    public getPointerType(type: LLVMTypeRef): LLVMTypeRef {
        return LLVM.PointerType(type, 0);
    }

    public bitcast(value: IRValue, targetType: LLVMTypeRef): IRValue {
        const builder = this.generator.builder;
        const result = LLVM.BuildBitCast(builder, value.value, targetType, "");
        return { value: result, type: targetType };
    }

    public getLLVMTypeByName(name: string): LLVMTypeRef {
        if (this.namedStructs.has(name)) {
            return this.namedStructs.get(name)!;
        }
        const structType = LLVM.StructCreateNamed(this.context, name);
        this.namedStructs.set(name, structType);
        return structType;
    }

    public ensureArrayStructDefinition(elementType: LLVMTypeRef): LLVMTypeRef {
        const existing = this.arrayStructs.get(elementType);
        if (existing) return existing;

        const structElements = [
            LLVM.PointerType(elementType, 0),
            LLVM.Int64TypeInContext(this.context),
            LLVM.Int64TypeInContext(this.context)
        ];
        const structType = LLVM.StructTypeInContext(this.context, structElements, structElements.length, 0);
        this.arrayStructs.set(elementType, structType);
        this.arrayElementTypes.set(structType, elementType);
        return structType;
    }

    public getArrayElementType(arrayType: LLVMTypeRef): LLVMTypeRef | null {
        return this.arrayElementTypes.get(arrayType) || null;
    }

    public getClosureFunctionType(closureType: LLVMTypeRef): LLVMTypeRef | null {
        return this.closureFunctionTypes.get(closureType) || null;
    }

    public getPromiseValueType(promiseType: LLVMTypeRef): LLVMTypeRef | null {
        return this.promiseValueTypes.get(promiseType) || null;
    }

    public getPromiseStructType(promiseType: LLVMTypeRef): LLVMTypeRef | null {
        return this.promiseStructTypes.get(promiseType) || null;
    }

    private getTypeKey(typeAnnotation: TypeAnnotation | null): string {
        if (!typeAnnotation) return 'void';
        if (typeAnnotation instanceof PointerTypeAnnotation) return `ptr:${this.getTypeKey(typeAnnotation.baseType)}`;
        if (typeAnnotation instanceof ArrayTypeAnnotation) return `array:${this.getTypeKey(typeAnnotation.elementType)}`;
        if (typeAnnotation instanceof FunctionTypeAnnotation) return this.getFunctionTypeKey(typeAnnotation);
        if (typeAnnotation instanceof BasicTypeAnnotation) return `basic:${typeAnnotation.name.lexeme}`;
        return 'unknown';
    }

    private getFunctionTypeKey(typeAnnotation: FunctionTypeAnnotation): string {
        return `fun(${typeAnnotation.parameters.map(p => this.getTypeKey(p)).join(',')})->${this.getTypeKey(typeAnnotation.returnType)}`;
    }
}
