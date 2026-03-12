export interface IFinder {
    getStdLibModulePath(osIdentifier: string, archIdentifier: string, moduleName: string): string;
    getBootstrapPath(osIdentifier: string, archIdentifier: string): string;
    getLinkerDynamicLinker(osIdentifier: string, archIdentifier: string): string;
    getLinkerFlags(osIdentifier: string, archIdentifier: string): string[];
}
export declare class ProjectFinder implements IFinder {
    private projectRoot;
    private stdLibRootPath;
    constructor(projectRoot: string, stdLibRootPath?: string);
    getStdLibModulePath(osIdentifier: string, archIdentifier: string, moduleName: string): string;
    getBootstrapPath(osIdentifier: string, archIdentifier: string): string;
    getLinkerDynamicLinker(osIdentifier: string, archIdentifier: string): string;
    getLinkerFlags(osIdentifier: string, archIdentifier: string): string[];
}
//# sourceMappingURL=Finder.d.ts.map