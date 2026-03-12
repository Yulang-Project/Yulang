// src/generator/llvm_ir_helpers.ts
import { ASTNode, BasicTypeAnnotation, ArrayTypeAnnotation, TypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation } from "../ast.js";
import { Token, TokenType } from "../token.js";
import { resolveLangItemType } from "./builtins.js";
import { LangItems } from "./lang_items.js";
import { LLVM } from "../llvm/index.js";
export class LLVMIRHelper {
    context;
    stringConstantCounter = 0;
    stringStructConstantCounter = 0;
    globalStringStructs = {};
    generator;
    namedStructs = new Map();
    constructor() {
        this.context = LLVM.ContextCreate();
    }
    getContext() {
        return this.context;
    }
    setGenerator(gen) {
        this.generator = gen;
    }
    getGenerator() {
        return this.generator;
    }
    getTargetTriple() {
        return this.generator.platform.architecture.getTargetTriple();
    }
    getDataLayout() {
        return this.generator.platform.architecture.getDataLayout();
    }
    createGlobalString(value) {
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
        const indices = [LLVM.ConstInt(LLVM.Int32TypeInContext(this.context), 0, 0), LLVM.ConstInt(LLVM.Int32TypeInContext(this.context), 0, 0)];
        const charPtrValue = LLVM.ConstInBoundsGEP2(charArrayType, charPtrGlobal, indices, 2);
        const stringStructVal = LLVM.ConstNamedStruct(llvmStringType, [
            charPtrValue,
            LLVM.ConstInt(LLVM.Int64TypeInContext(this.context), value.length, 0)
        ], 2);
        const stringStructGlobal = LLVM.AddGlobal(module, llvmStringType, stringStructGlobalName);
        LLVM.SetInitializer(stringStructGlobal, stringStructVal);
        LLVM.SetGlobalConstant(stringStructGlobal, 1);
        const entry = {
            charPtrGlobal,
            stringStructGlobal,
            charArrayType,
            length: value.length,
        };
        this.globalStringStructs[value] = entry;
        return entry;
    }
    getLLVMType(typeAnnotation) {
        if (!typeAnnotation)
            return LLVM.VoidTypeInContext(this.context);
        if (typeAnnotation instanceof PointerTypeAnnotation) {
            return LLVM.PointerType(this.getLLVMType(typeAnnotation.baseType), 0);
        }
        if (typeAnnotation instanceof FunctionTypeAnnotation) {
            const paramTypes = typeAnnotation.parameters.map(p => this.getLLVMType(p));
            const returnType = this.getLLVMType(typeAnnotation.returnType);
            const paramsWithEnv = [LLVM.PointerType(LLVM.Int8TypeInContext(this.context), 0), ...paramTypes];
            const funcType = LLVM.FunctionType(returnType, paramsWithEnv, paramsWithEnv.length, 0);
            const funcPtrType = LLVM.PointerType(funcType, 0);
            // Represent closures uniformly as { func_ptr, env_ptr }
            const structElements = [funcPtrType, LLVM.PointerType(LLVM.Int8TypeInContext(this.context), 0)];
            return LLVM.StructTypeInContext(this.context, structElements, structElements.length, 0);
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
    getNewTempVar() {
        return ""; // LLVM C API will auto-generate if name is empty
    }
    getNewUniqueName(prefix) {
        return `${prefix}.${this.stringConstantCounter++}`;
    }
    getAlign(llvmType) {
        // This is now less useful since LLVM handles it, but kept for compatibility
        return 8;
    }
    sizeOf(llvmType) {
        return 8;
    }
    getPointerType(type) {
        return LLVM.PointerType(type, 0);
    }
    bitcast(value, targetType) {
        const builder = this.generator.builder;
        const result = LLVM.BuildBitCast(builder, value.value, targetType, "");
        return { value: result, type: targetType };
    }
    getLLVMTypeByName(name) {
        if (this.namedStructs.has(name)) {
            return this.namedStructs.get(name);
        }
        const structType = LLVM.StructCreateNamed(this.context, name);
        this.namedStructs.set(name, structType);
        return structType;
    }
    ensureArrayStructDefinition(elementType) {
        const structElements = [
            LLVM.PointerType(elementType, 0),
            LLVM.Int64TypeInContext(this.context),
            LLVM.Int64TypeInContext(this.context)
        ];
        return LLVM.StructTypeInContext(this.context, structElements, structElements.length, 0);
    }
}
//# sourceMappingURL=llvm_ir_helpers.js.map