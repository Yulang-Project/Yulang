// src/generator/llvm_ir_helpers.ts

import { ASTNode, BasicTypeAnnotation, ArrayTypeAnnotation, TypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation } from "../ast.js";
import { Token, TokenType } from "../token.js";
import { resolveLangItemType } from "./builtins.js";
import { LangItems } from "./lang_items.js";
import type { IRValue } from "./ir_generator.js";

type GlobalStringEntry = {
    charPtrGlobalName: string; // Name of the global for the char array (e.g., @.str.0)
    stringStructGlobalName: string; // Name of the global for the %struct.String (e.g., @.string.0)
    charArrayType: string; // Type of the char array (e.g., [8 x i8])
    length: number; // Length of the string (excluding null terminator)
    charPtrDefinition: string; // LLVM IR definition for the char array global
    stringStructDefinition: string; // LLVM IR definition for the %struct.String global
};

export class LLVMIRHelper {
    private tempVarCounter = 1000;
    private stringConstantCounter = 0;
    private stringStructConstantCounter = 0; // NEW counter for string struct globals
    private globalStringStructs: { [key: string]: GlobalStringEntry } = {}; // NEW map to store managed string globals
    private generator: any; // IRGenerator, but use 'any' to avoid circular dependency

    public setGenerator(gen: any) {
        this.generator = gen;
    }

    public getGenerator(): any {
        return this.generator;
    }

    // TODO: Make these configurable or deduce from target environment
    public getTargetTriple(): string {
        return this.generator.platform.architecture.getTargetTriple();
    }

    public getDataLayout(): string {
        return this.generator.platform.architecture.getDataLayout();
    }

    public getNewTempVar(): string {
        return `%t${this.tempVarCounter++}`;
    }

    private uniqueNameCounter = 0;
    public getNewUniqueName(prefix: string): string {
        return `${prefix}_${this.uniqueNameCounter++}`;
    }

    public createGlobalString(value: string): GlobalStringEntry {
        if (this.globalStringStructs[value]) { // Check the new map
            return this.globalStringStructs[value];
        }

        // 1. Create the char array global
        const charPtrGlobalName = `@.str.${this.stringConstantCounter++}`;
        const cString = value.replace(/\\/g, '\\5C').replace(/"/g, '\\22').replace(/\n/g, '\\0A').replace(/\t/g, '\\09'); // Use hex escapes
        const rawLength = Buffer.from(value, 'utf8').length; // Actual string length, without null terminator
        const charArrayType = `[${rawLength + 1} x i8]`; // Type includes null terminator
        const charPtrDefinition = `${charPtrGlobalName} = private unnamed_addr constant ${charArrayType} c"${cString}\\00", align 1`;

        // 2. Create the %struct.String global
        const stringStructGlobalName = `@.string.${this.stringStructConstantCounter++}`;
        const llvmStringType = LangItems.string.structName;
        
        // Get the i8* pointer to the start of the char array
        const charPtrValue = `getelementptr inbounds (${charArrayType}, ${charArrayType}* ${charPtrGlobalName}, i64 0, i64 0)`;
        
        // Define the string struct global
        const stringStructDefinition = 
            `${stringStructGlobalName} = private unnamed_addr constant ${llvmStringType} { ` +
            `i8* ${charPtrValue}, ` + // pointer to char array
            `i64 ${rawLength}` +     // current length (i64)
            `}, align 8`; // Alignment for the struct

        const entry: GlobalStringEntry = {
            charPtrGlobalName,
            stringStructGlobalName,
            charArrayType,
            length: rawLength,
            charPtrDefinition,
            stringStructDefinition,
        };
        this.globalStringStructs[value] = entry; // Store in the new map

        return entry;
    }

    public getGlobalStrings(): string[] {
        // Updated to return both definitions
        return Object.values(this.globalStringStructs).flatMap(s => [s.charPtrDefinition, s.stringStructDefinition]);
    }

    public getLLVMType(typeAnnotation: TypeAnnotation | null): string {
        if (!typeAnnotation) return 'void';

        if (typeAnnotation instanceof PointerTypeAnnotation) {
            return `${this.getLLVMType(typeAnnotation.baseType)}*`;
        }

        if (typeAnnotation instanceof FunctionTypeAnnotation) {
            const paramTypes = typeAnnotation.parameters.map(p => this.getLLVMType(p));
            const returnType = this.getLLVMType(typeAnnotation.returnType);
            const paramsWithEnv = ['i8*', ...paramTypes].filter(p => p.length > 0);
            const funcSig = `${returnType} (${paramsWithEnv.join(', ')})*`;
            // Represent closures uniformly as { func_ptr, env_ptr }*
            return `{ ${funcSig}, i8* }*`;
        }

        if (typeAnnotation instanceof ArrayTypeAnnotation) {
            const elementType = this.getLLVMType(typeAnnotation.elementType);
            return this.ensureArrayStructDefinition(elementType);
        }

        if (typeAnnotation instanceof BasicTypeAnnotation) {
            const typeName = typeAnnotation.name.lexeme;

            // 1. Try to resolve as a language item (e.g. "string" -> "%struct.string")
            const resolvedType = resolveLangItemType(typeName);
            if (resolvedType) {
                // For "string", return the struct type itself, not a pointer.
                // It will be allocated on the stack as a value.
                return resolvedType;
            }
            
            // 2. Fallback to primitive types
            switch (typeName) {
                case 'int':
                    return 'i64';
                case 'i32':
                    return 'i32';
                case 'i64':
                    return 'i64';
                case 'f32':
                    return 'f32';
                case 'f64':
                    return 'f64';
                case 'i16': // Added i16 type mapping
                    return 'i16';
                case 'bool':
                    return 'i1';
                case 'char':
                    return 'i8';
                case 'void':
                    return 'void';
            }
            
            // 3. Fallback to assuming it's a user-defined reference type (pointer to struct)
            //    This will result in '%struct.TypeName*'
            return `%struct.${typeName}`;
        }
        
        return 'void'; // Final fallback
    }

    public getAlign(llvmType: string): number {
        if (llvmType.endsWith('*')) return 8; // Pointers are 8-byte aligned on 64-bit systems
        if (llvmType === 'i64' || llvmType === 'f64') return 8;
        if (llvmType === 'i32' || llvmType === 'f32') return 4;
        if (llvmType === 'i16') return 2;
        if (llvmType === 'i8' || llvmType === 'i1') return 1;
        if (llvmType === LangItems.string.structName) return 8; // Alignment for string struct
        // New: Array struct alignment
        if (llvmType.startsWith(LangItems.array.structPrefix)) return 8; // Array struct contains a pointer, so 8-byte aligned
        
        return 1; // Default to 1-byte alignment
    }

    public sizeOf(llvmType: string): number {
        if (llvmType.endsWith('*')) return 8; // Pointers are 8 bytes on 64-bit systems
        switch (llvmType) {
            case 'i64':
            case 'f64':
                return 8;
            case 'i32':
            case 'f32':
                return 4;
            case 'i16':
                return 2;
            case 'i8':
            case 'i1':
                return 1;
            case LangItems.string.structName:
                return 16; // string struct is { i8*, i64 } -> 8 + 8 = 16 bytes
            // New: Array struct size
            case llvmType.startsWith(LangItems.array.structPrefix) ? llvmType : '': // Check if it's an array struct
                return 24; // array struct is { T*, i64, i64 } -> 8 + 8 + 8 = 24 bytes
            default:
                // For structs, we'd need more complex logic. For now, assume a reasonable default.
                // For closure environment, we are summing `sizeOf(pointer)`, so this won't be hit for now.
                return 8; // Default to pointer size as a fallback for unknown types
        }
    }

    public getTypeFromIR(irValue: string): string {
        // This is a heuristic and would be better handled with a proper symbol table in the generator.
        if (irValue.startsWith('%')) {
            // Cannot determine type from temp var alone without context.
            return 'i32'; // Default assumption
        }
        
        const parts = irValue.trim().split(' ');
        if (parts.length > 0 && parts[0]) {
            if(parts[0].match(/^(i\d+|f\d+|\%struct\.[a-zA-Z0-9_]+)\*?$/)) {
                return parts[0];
            }
        }

        return 'void'; // Default to void
    }

    public getPointerType(type: string): string {
        return `${type}*`;
    }

    public ensureArrayStructDefinition(elementTypeLlvmType: string): string {
        // Sanitize the element type name for use in the struct name.
        // Replace special characters like '%', '*', '.' with '_' and spaces.
        const sanitizedElementType = elementTypeLlvmType.replace(/[%*.]/g, '_').replace(/ /g, '');
        const arrayStructName = `${LangItems.array.structPrefix}.${sanitizedElementType}`;

        const ptrType = this.getPointerType(elementTypeLlvmType); // The pointer to the actual array data
        // Define the array struct: { element_type*, i64 len, i64 cap }
        const definition = `${arrayStructName} = type { ${ptrType}, i64, i64 }`;

        // Request IRGenerator to emit this definition, ensuring it's only emitted once.
        // This relies on IRGenerator's emitHoisted to handle deduplication.
        this.generator.emitHoisted(definition);
        
        return arrayStructName;
    }

    public bitcast(value: IRValue, targetType: string): IRValue {
        const resultVar = this.getNewTempVar();
        this.generator.emit(`${resultVar} = bitcast ${value.type} ${value.value} to ${targetType}`);
        return { value: resultVar, type: targetType };
    }
}
