import koffi from 'koffi';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载 LLVM 共享库
const libPath = path.resolve(process.cwd(), 'llvm/libLLVM.so');
const lib = koffi.load(libPath);

// LLVM 不透明指针类型定义 (用于 koffi 绑定)
const LLVMContextRef_t = koffi.pointer('LLVMContextRef', koffi.opaque());
const LLVMModuleRef_t = koffi.pointer('LLVMModuleRef', koffi.opaque());
const LLVMTypeRef_t = koffi.pointer('LLVMTypeRef', koffi.opaque());
const LLVMValueRef_t = koffi.pointer('LLVMValueRef', koffi.opaque());
const LLVMBuilderRef_t = koffi.pointer('LLVMBuilderRef', koffi.opaque());
const LLVMBasicBlockRef_t = koffi.pointer('LLVMBasicBlockRef', koffi.opaque());
const LLVMAttributeRef_t = koffi.pointer('LLVMAttributeRef', koffi.opaque());

// TypeScript 类型定义
export type LLVMContextRef = any;
export type LLVMModuleRef = any;
export type LLVMTypeRef = any;
export type LLVMValueRef = any;
export type LLVMBuilderRef = any;
export type LLVMBasicBlockRef = any;
export type LLVMAttributeRef = any;

// 核心函数绑定
export const LLVM = {
    // 上下文与模块
    ContextCreate: lib.func('LLVMContextCreate', LLVMContextRef_t, []),
    ContextDispose: lib.func('LLVMContextDispose', 'void', [LLVMContextRef_t]),
    ModuleCreateWithNameInContext: lib.func('LLVMModuleCreateWithNameInContext', LLVMModuleRef_t, ['string', LLVMContextRef_t]),
    DisposeModule: lib.func('LLVMDisposeModule', 'void', [LLVMModuleRef_t]),
    PrintModuleToString: lib.func('LLVMPrintModuleToString', 'string', [LLVMModuleRef_t]),
    
    // 指令构建器
    CreateBuilderInContext: lib.func('LLVMCreateBuilderInContext', LLVMBuilderRef_t, [LLVMContextRef_t]),
    DisposeBuilder: lib.func('LLVMDisposeBuilder', 'void', [LLVMBuilderRef_t]),
    PositionBuilderAtEnd: lib.func('LLVMPositionBuilderAtEnd', 'void', [LLVMBuilderRef_t, LLVMBasicBlockRef_t]),
    GetInsertBlock: lib.func('LLVMGetInsertBlock', LLVMBasicBlockRef_t, [LLVMBuilderRef_t]),

    // 类型系统
    Int1TypeInContext: lib.func('LLVMInt1TypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    Int8TypeInContext: lib.func('LLVMInt8TypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    Int16TypeInContext: lib.func('LLVMInt16TypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    Int32TypeInContext: lib.func('LLVMInt32TypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    Int64TypeInContext: lib.func('LLVMInt64TypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    FloatTypeInContext: lib.func('LLVMFloatTypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    DoubleTypeInContext: lib.func('LLVMDoubleTypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    VoidTypeInContext: lib.func('LLVMVoidTypeInContext', LLVMTypeRef_t, [LLVMContextRef_t]),
    PointerType: lib.func('LLVMPointerType', LLVMTypeRef_t, [LLVMTypeRef_t, 'uint32']),
    ArrayType: lib.func('LLVMArrayType', LLVMTypeRef_t, [LLVMTypeRef_t, 'uint32']),
    StructTypeInContext: lib.func('LLVMStructTypeInContext', LLVMTypeRef_t, [LLVMContextRef_t, koffi.pointer(LLVMTypeRef_t), 'uint32', 'int']),
    StructCreateNamed: lib.func('LLVMStructCreateNamed', LLVMTypeRef_t, [LLVMContextRef_t, 'string']),
    StructSetBody: lib.func('LLVMStructSetBody', 'void', [LLVMTypeRef_t, koffi.pointer(LLVMTypeRef_t), 'uint32', 'int']),

    // 函数定义
    AddFunction: lib.func('LLVMAddFunction', LLVMValueRef_t, [LLVMModuleRef_t, 'string', LLVMTypeRef_t]),
    GetNamedFunction: lib.func('LLVMGetNamedFunction', LLVMValueRef_t, [LLVMModuleRef_t, 'string']),
    FunctionType: lib.func('LLVMFunctionType', LLVMTypeRef_t, [LLVMTypeRef_t, koffi.pointer(LLVMTypeRef_t), 'uint32', 'int']),
    AppendBasicBlockInContext: lib.func('LLVMAppendBasicBlockInContext', LLVMBasicBlockRef_t, [LLVMContextRef_t, LLVMValueRef_t, 'string']),
    GetBasicBlockParent: lib.func('LLVMGetBasicBlockParent', LLVMValueRef_t, [LLVMBasicBlockRef_t]),
    GetParam: lib.func('LLVMGetParam', LLVMValueRef_t, [LLVMValueRef_t, 'uint32']),

    // 指令构建 - 算术
    BuildAdd: lib.func('LLVMBuildAdd', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildSub: lib.func('LLVMBuildSub', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildMul: lib.func('LLVMBuildMul', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildSDiv: lib.func('LLVMBuildSDiv', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildUDiv: lib.func('LLVMBuildUDiv', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildSRem: lib.func('LLVMBuildSRem', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildURem: lib.func('LLVMBuildURem', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildAnd: lib.func('LLVMBuildAnd', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildOr: lib.func('LLVMBuildOr', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildXor: lib.func('LLVMBuildXor', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildShl: lib.func('LLVMBuildShl', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildAShr: lib.func('LLVMBuildAShr', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildLShr: lib.func('LLVMBuildLShr', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t, 'string']),
    
    // 指令构建 - 内存
    BuildAlloca: lib.func('LLVMBuildAlloca', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMTypeRef_t, 'string']),
    BuildLoad2: lib.func('LLVMBuildLoad2', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMTypeRef_t, LLVMValueRef_t, 'string']),
    BuildStore: lib.func('LLVMBuildStore', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMValueRef_t]),
    BuildGEP2: lib.func('LLVMBuildGEP2', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMTypeRef_t, LLVMValueRef_t, koffi.pointer(LLVMValueRef_t), 'uint32', 'string']),
    BuildInBoundsGEP2: lib.func('LLVMBuildInBoundsGEP2', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMTypeRef_t, LLVMValueRef_t, koffi.pointer(LLVMValueRef_t), 'uint32', 'string']),

    // 指令构建 - 控制流
    BuildRet: lib.func('LLVMBuildRet', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t]),
    BuildRetVoid: lib.func('LLVMBuildRetVoid', LLVMValueRef_t, [LLVMBuilderRef_t]),
    BuildBr: lib.func('LLVMBuildBr', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMBasicBlockRef_t]),
    BuildCondBr: lib.func('LLVMBuildCondBr', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMBasicBlockRef_t, LLVMBasicBlockRef_t]),
    BuildCall2: lib.func('LLVMBuildCall2', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMTypeRef_t, LLVMValueRef_t, koffi.pointer(LLVMValueRef_t), 'uint32', 'string']),

    // 常量构建
    ConstInt: lib.func('LLVMConstInt', LLVMValueRef_t, [LLVMTypeRef_t, 'uint64', 'int']),
    ConstReal: lib.func('LLVMConstReal', LLVMValueRef_t, [LLVMTypeRef_t, 'double']),
    ConstStringInContext: lib.func('LLVMConstStringInContext', LLVMValueRef_t, [LLVMContextRef_t, 'string', 'uint32', 'int']),
    ConstStructInContext: lib.func('LLVMConstStructInContext', LLVMValueRef_t, [LLVMContextRef_t, koffi.pointer(LLVMValueRef_t), 'uint32', 'int']),
    ConstNamedStruct: lib.func('LLVMConstNamedStruct', LLVMValueRef_t, [LLVMTypeRef_t, koffi.pointer(LLVMValueRef_t), 'uint32']),
    ConstArray: lib.func('LLVMConstArray', LLVMValueRef_t, [LLVMTypeRef_t, koffi.pointer(LLVMValueRef_t), 'uint32']),
    ConstInBoundsGEP2: lib.func('LLVMConstInBoundsGEP2', LLVMValueRef_t, [LLVMTypeRef_t, LLVMValueRef_t, koffi.pointer(LLVMValueRef_t), 'uint32']),
    ConstGEP2: lib.func('LLVMConstGEP2', LLVMValueRef_t, [LLVMTypeRef_t, LLVMValueRef_t, koffi.pointer(LLVMValueRef_t), 'uint32']),
    ConstBitCast: lib.func('LLVMConstBitCast', LLVMValueRef_t, [LLVMValueRef_t, LLVMTypeRef_t]),

    AddGlobal: lib.func('LLVMAddGlobal', LLVMValueRef_t, [LLVMModuleRef_t, LLVMTypeRef_t, 'string']),
    SetInitializer: lib.func('LLVMSetInitializer', 'void', [LLVMValueRef_t, LLVMValueRef_t]),
    SetGlobalConstant: lib.func('LLVMSetGlobalConstant', 'void', [LLVMValueRef_t, 'int']),

    // 转换
    BuildBitCast: lib.func('LLVMBuildBitCast', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMTypeRef_t, 'string']),
    BuildPtrToInt: lib.func('LLVMBuildPtrToInt', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMTypeRef_t, 'string']),
    BuildIntToPtr: lib.func('LLVMBuildIntToPtr', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMTypeRef_t, 'string']),
    BuildZExt: lib.func('LLVMBuildZExt', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMTypeRef_t, 'string']),
    BuildSExt: lib.func('LLVMBuildSExt', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMTypeRef_t, 'string']),
    BuildTrunc: lib.func('LLVMBuildTrunc', LLVMValueRef_t, [LLVMBuilderRef_t, LLVMValueRef_t, LLVMTypeRef_t, 'string']),

    // 比较
    BuildICmp: lib.func('LLVMBuildICmp', LLVMValueRef_t, [LLVMBuilderRef_t, 'int', LLVMValueRef_t, LLVMValueRef_t, 'string']),
    BuildFCmp: lib.func('LLVMBuildFCmp', LLVMValueRef_t, [LLVMBuilderRef_t, 'int', LLVMValueRef_t, LLVMValueRef_t, 'string']),

    // 其他
    SetTarget: lib.func('LLVMSetTarget', 'void', [LLVMModuleRef_t, 'string']),
    SetDataLayout: lib.func('LLVMSetDataLayout', 'void', [LLVMModuleRef_t, 'string']),

    // 类型信息
    GetTypeKind: lib.func('LLVMGetTypeKind', 'int', [LLVMTypeRef_t]),
    GetIntTypeWidth: lib.func('LLVMGetIntTypeWidth', 'uint32', [LLVMTypeRef_t]),
    TypeOf: lib.func('LLVMTypeOf', LLVMTypeRef_t, [LLVMValueRef_t]),
    GetElementType: lib.func('LLVMGetElementType', LLVMTypeRef_t, [LLVMTypeRef_t]),
    GetReturnType: lib.func('LLVMGetReturnType', LLVMTypeRef_t, [LLVMTypeRef_t]),
    };


// LLVMTypeKind 枚举
export const LLVMTypeKind = {
    LLVMVoidTypeKind: 0,
    LLVMHalfTypeKind: 1,
    LLVMFloatTypeKind: 2,
    LLVMDoubleTypeKind: 3,
    LLVMX86_FP80TypeKind: 4,
    LLVMFP128TypeKind: 5,
    LLVMPPC_FP128TypeKind: 6,
    LLVMLabelTypeKind: 7,
    LLVMIntegerTypeKind: 8,
    LLVMFunctionTypeKind: 9,
    LLVMStructTypeKind: 10,
    LLVMArrayTypeKind: 11,
    LLVMPointerTypeKind: 12,
    LLVMVectorTypeKind: 13,
    LLVMMetadataTypeKind: 14,
    LLVMX86_MMXTypeKind: 15,
    LLVMTokenTypeKind: 16,
    LLVMScalableVectorTypeKind: 17,
    LLVMBHTYpeKind: 18,
};

// 谓词枚举值 (部分)
export const LLVMIntPredicate = {
    LLVMIntEQ: 32,
    LLVMIntNE: 33,
    LLVMIntUGT: 34,
    LLVMIntUGE: 35,
    LLVMIntULT: 36,
    LLVMIntULE: 37,
    LLVMIntSGT: 38,
    LLVMIntSGE: 39,
    LLVMIntSLT: 40,
    LLVMIntSLE: 41,
};
