// src/platform/IStandardLibrary.ts
import * as path from 'path';

export interface IStandardLibrary {
    // 获取标准库模块的完整路径 (e.g., "std/io" -> "/path/to/project_root/std/io.yu")
    getStdLibModulePath(moduleName: string): string;

    // 获取引导文件 (bootstrap.o) 的完整路径
    getBootstrapPath(): string;
}
