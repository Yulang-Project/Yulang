// src/Finder.ts
import * as path from 'path';
import * as fs from 'fs';

// 定义标准库查找器的接口
export interface IFinder {
    getStdLibModulePath(osIdentifier: string, archIdentifier: string, moduleName: string): string;
    getLinkerFlags(osIdentifier: string, archIdentifier: string): string[];
}

// ProjectFinder 实现了 IFinder 接口，负责根据项目结构查找标准库路径
export class ProjectFinder implements IFinder {
    private projectRoot: string; // 项目根目录
    private stdLibRootPath: string; // 标准库在项目根目录下的相对路径，例如 "libs"

    constructor(projectRoot: string, stdLibRootPath: string = 'libs') {
        this.projectRoot = projectRoot;
        this.stdLibRootPath = stdLibRootPath;
    }

    // 获取标准库模块的完整路径 (e.g., "std/io" -> "/path/to/project_root/libs/linux/x86_64/std/io.yu")
    getStdLibModulePath(osIdentifier: string, archIdentifier: string, moduleName: string): string {
        const normalizedModuleName = moduleName.endsWith('/') ? moduleName.slice(0, -1) : moduleName;
        const resolvedModuleName = normalizedModuleName.startsWith('std:')
            ? normalizedModuleName.replace(/:/g, '/')
            : normalizedModuleName;

        const candidatePaths = [
            path.join(this.projectRoot, this.stdLibRootPath, `${resolvedModuleName}.yu`),
            path.join(this.projectRoot, this.stdLibRootPath, resolvedModuleName, 'index.yu'),
            path.join(this.projectRoot, this.stdLibRootPath, osIdentifier, archIdentifier, `${resolvedModuleName}.yu`),
            path.join(this.projectRoot, this.stdLibRootPath, osIdentifier, archIdentifier, resolvedModuleName, 'index.yu'),
            path.join(this.projectRoot, this.stdLibRootPath, osIdentifier, archIdentifier, 'std', `${resolvedModuleName}.yu`),
        ];

        for (const candidatePath of candidatePaths) {
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        }

        return candidatePaths[0]!;
    }

    // 获取额外的链接器标志
    getLinkerFlags(osIdentifier: string, archIdentifier: string): string[] {
        // Link the lightweight GC runtime and static libuv event loop runtime.
        return ['-l:libgc.so.1', '/usr/lib/x86_64-linux-gnu/libuv.a', '-pthread', '-ldl', '-lrt', '-lc'];
    }
}
