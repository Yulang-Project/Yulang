import { LLVM } from './llvm/index.js';
try {
    const context = LLVM.ContextCreate();
    console.log('Context created');
    const module = LLVM.ModuleCreateWithNameInContext('test', context);
    console.log('Module created');
    const i64Type = LLVM.Int64TypeInContext(context);
    const funcType = LLVM.FunctionType(i64Type, [], 0, 0);
    const func = LLVM.AddFunction(module, 'main', funcType);
    const block = LLVM.AppendBasicBlockInContext(context, func, 'entry');
    const builder = LLVM.CreateBuilderInContext(context);
    LLVM.PositionBuilderAtEnd(builder, block);
    const val = LLVM.ConstInt(i64Type, 42, 0);
    LLVM.BuildRet(builder, val);
    const ir = LLVM.PrintModuleToString(module);
    console.log('Generated IR:');
    console.log(ir);
    LLVM.DisposeBuilder(builder);
    LLVM.DisposeModule(module);
    LLVM.ContextDispose(context);
    console.log('Done');
}
catch (e) {
    console.error('Error:', e);
}
//# sourceMappingURL=test_llvm.js.map