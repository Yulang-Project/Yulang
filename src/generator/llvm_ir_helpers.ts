// src/generator/llvm_ir_helpers.ts

import { ASTNode, BasicTypeAnnotation, ArrayTypeAnnotation, TypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation } from "../ast.js";
import { Token, TokenType } from "../token.js";
import { resolveLangItemType } from "./builtins.js";
import { LangItems } from "./lang_items.js";

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
        return "x86_64-pc-linux-gnu"; // Example: Adjust based on target OS/architecture
    }

    public getDataLayout(): string {
        return "e-m:e-i64:64-f80:128-n8:16:32:64-S128"; // Example: Adjust based on target architecture
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
            // Placeholder logic, might need to be more complex (e.g. a struct)
            return `${this.getLLVMType(typeAnnotation.elementType)}*`;
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
}
