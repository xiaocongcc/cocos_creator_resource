import { SceneUuidMap } from "./SceneUtil";

// 资源加载进度回调
export type ProgressCallback = (completeCount: number, totalCount: number, item: any) => void;

// 资源加载完成回调
export type CompletedCallback = (error: Error, resource: any) => void;

/**资源的引用和使用记录结构体 */
interface CacheInfo {
    refs: Set<string>,
    uses: Set<string>,
}

/**LoadRes方法的参数结构 */
interface LoadResArgs {
    url: string,
    type?: typeof cc.Asset,
    onCompleted?: CompletedCallback,
    onProgress?: ProgressCallback,
    use?: string,
}

/**ReleaseRes方法的参数结构 */
interface ReleaseResArgs {
    url: string,
    type?: typeof cc.Asset,
    use?: string,
}

interface LoadingInfo {
    use?: string,
    onCompleted?: CompletedCallback,
}

// 兼容性处理
let isChildClassOf = cc.js["isChildClassOf"]
if (!isChildClassOf) {
    isChildClassOf = cc["isChildClassOf"];
}

/**
 * 资源加载类
 * 1. 加载完成后自动记录引用关系，根据dependKeys记录反向依赖
 * 2. 能够安全释放依赖资源（一个资源同时被多个资源引用，只有当其他资源都释放时，该资源才会被释放）
 */
export default class ResourceLoader {
    private static _instance: ResourceLoader = null;
    public static getInstance() {
        if (!this._instance) {
            this._instance = new ResourceLoader();
        }
        return this._instance;
    }

    public static ResourceIndex: number = 0;

    private _resMap: Map<string, CacheInfo> = new Map<string, CacheInfo>();

    /**
     * 同个资源在加载过程中重复申请的，放到这个列表
     * 等到资源加载完毕再执行CompletedCallback函数
     */
    private _loadingResMap: Map<string, Array<LoadingInfo>> = new Map<string, Array<LoadingInfo>>();

    private _loadedSceneRecord: Array<string> = [];

    /**
     * 生成一个资源使用key
     * @param where 在哪里使用，如Scene、UI、Pool...
     * @param who 使用者，如LoginUI，UIHelp...
     * @param why 使用原因
     */
    public static createUseKey(where: string, who: string = 'none', why: string = ''): string {
        return `use_${where}_by_${who}_for${why}`;
    }

    /**
     * 获取资源缓存信息
     * @param key 
     */
    public getCacheInfo(key: string): CacheInfo {
        if (!this._resMap.has(key)) {
            this._resMap.set(key, {
                refs: new Set<string>(),
                uses: new Set<string>(),
            });
        }
        return this._resMap.get(key);
    }

    /**
     * 从cc.loader中获取一个资源的item
     * @param url 查询的url
     * @param type 查询的类型
     */
    private _getResItem(url: string, type?: typeof cc.Asset): any {
        let ccloader: any = cc.loader;
        let item: cc.LoadingItems = ccloader._cache[url];
        if (!item) {
            let uuid = ccloader._getResUuid(url, type, false);
            if (uuid) {
                let refKey = ccloader._getReferenceKey(uuid);
                item = ccloader._cache[refKey];
            }
        }
        return item;
    }

    /**
     * loadRes方法的参数预处理
     */
    private _dealLoadResArgs(): LoadResArgs {
        if (arguments.length < 1 || typeof arguments[0] != 'string') {
            console.error(`_dealLoadResArgs error ${arguments}`);
            return;
        }
        let ret: LoadResArgs = { url: arguments[0] };
        for (let i = 1; i < arguments.length; ++i) {
            if (i == 1 && isChildClassOf(arguments[i], cc.RawAsset)) {
                // 判断是不是第一个参数type
                ret.type = arguments[i];
            } else if (i == arguments.length - 1 && typeof arguments[i] == "string") {
                // 判断是不是最后一个参数use
                ret.use = arguments[i];
            } else if (typeof arguments[i] == "function") {
                // 其他情况为函数
                if (arguments.length > i + 1 && typeof arguments[i + 1] == "function") {
                    ret.onProgress = arguments[i];
                } else {
                    ret.onCompleted = arguments[i];
                }
            }
        }
        return ret;
    }

    /**
     * releaseRes方法的参数预处理
     */
    private _dealReleaseResArgs(): ReleaseResArgs {
        if (arguments.length < 1 || typeof arguments[0] != "string") {
            console.error(`_dealReleaseResArgs error ${arguments}`);
            return null;
        }
        let ret: ReleaseResArgs = { url: arguments[0] };
        for (let i = 1; i < arguments.length; ++i) {
            if (typeof arguments[i] == "string") {
                ret.use = arguments[i];
            } else {
                ret.type = arguments[i];
            }
        }
        return ret;
    }

    /**
     * 开始加载资源
     * @param url           资源url
     * @param type          资源类型，默认为null
     * @param onProgress    加载进度回调
     * @param onCompleted   加载完成回调
     * @param use           资源使用key，根据makeUseKey方法生成
     */
    public loadRes(url: string, use?: string);
    public loadRes(url: string, onCompleted: CompletedCallback, use?: string);
    public loadRes(url: string, onProgress: ProgressCallback, onCompleted: CompletedCallback, use?: string);
    public loadRes(url: string, type: typeof cc.Asset, use?: string);
    public loadRes(url: string, type: typeof cc.Asset, onCompleted: CompletedCallback, use?: string);
    public loadRes(url: string, type: typeof cc.Asset, onProgress: ProgressCallback, onCompleted: CompletedCallback, use?: string);
    public loadRes() {
        let args = this._dealLoadResArgs.apply(this, arguments);
        if (this._loadingResMap.has(args.url)) {
            this._loadingResMap.get(args.url).push({ onCompleted: args.onCompleted, use: args.use });
            return;
        }
        this._loadingResMap.set(args.url, [{ onCompleted: args.onCompleted, use: args.use }]);
        console.time('LoadRes|' + args.url);

        let finishCallback = (error: Error, resource: any) => {
            // 加载资源出错了，后续不处理
            if (error) {
                console.error(`ResourceLoader.loadRes ${args.url} failed! error = ${error}`);
                return;
            }

            let addDependKey = (item, refKey) => {
                // 资源的依赖放在item.dependKeys
                if (item && item.dependKeys && Array.isArray(item.dependKeys)) {
                    for (let depKey of item.dependKeys) {
                        // 记录这个资源被引用
                        this.getCacheInfo(depKey).refs.add(refKey);
                        // console.log('refs', depKey, refKey);
                        let ccloader: any = cc.loader;
                        let depItem = ccloader._cache[depKey];
                        addDependKey(depItem, refKey);
                    }
                }
            }

            let item = this._getResItem(args.url, args.type);
            // console.log(item);
            if (item && item.id) {
                addDependKey(item, item.id);
            } else {
                cc.warn(`addDependKey item error! for ${args.url}`);
            }

            // 给自己加一个自身的引用
            if (item) {
                this.getCacheInfo(item.id).refs.add(item.id);
            }

            let completeList = this._loadingResMap.get(args.url);
            for (let i = 0; i < completeList.length; i++) {
                let info = completeList[i];
                // 添加use
                if (item) {
                    if (info.use) {
                        this.getCacheInfo(item.id).uses.add(info.use);
                    }
                }
                info.onCompleted && info.onCompleted(error, resource);
            }
            this._loadingResMap.delete(args.url);
            console.timeEnd('LoadRes|' + args.url);
        }

        let res = cc.loader.getRes(args.url, args.type);
        if (res) {
            finishCallback(null, res);
        } else {
            cc.loader.loadRes(args.url, args.type, args.onProgress, finishCallback);
        }
    }

    /**
     * 释放资源
     * @param url   要释放的url
     * @param type  资源类型
     * @param use   要解除的资源使用key，根据makeUseKey方法生成
     */
    public releaseRes(url: string, use?: string);
    public releaseRes(url: string, type: typeof cc.Asset, use?: string)
    public releaseRes() {
        let args: ReleaseResArgs = this._dealReleaseResArgs.apply(this, arguments);
        let item = this._getResItem(args.url, args.type);
        if (!item) {
            console.warn(`releaseRes item is null ${args.url}`);
            return;
        }
        console.log('resource loader release item', item.id);
        let cacheInfo = this.getCacheInfo(item.id);
        if (args.use) {
            cacheInfo.uses.delete(args.use);
        }
        this._release(item, item.id);
    }

    /**释放一个资源 */
    private _release(item, key) {
        if (!item) {
            return;
        }
        let cacheInfo = this.getCacheInfo(item.id);

        let delDependKey = (item, refKey) => {
            if (item && item.dependKeys && Array.isArray(item.dependKeys)) {
                for (let depKey of item.dependKeys) {
                    let ccloader: any = cc.loader;
                    let depItem = ccloader._cache[depKey];
                    if (depItem)
                        this._release(depItem, refKey);
                }
            }
        };
        // 一个ref对应多个use时，不要做释放操作
        if (cacheInfo.refs.size == 1 && cacheInfo.uses.size > 0) {

        } else {
            // 解除引用关系
            cacheInfo.refs.delete(key);
            delDependKey(item, key);
        }
        if (cacheInfo.uses.size == 0 && cacheInfo.refs.size == 0) {
            // 如果没有uuid，就直接释放url
            if (item.uuid) {
                cc.loader.release(item.uuid);
                // cc.log('resource leader relase item by uuid :' + item.uuid);
            } else {
                cc.loader.release(item.id);
                // cc.log('resource leader relase item by id :' + item.id);
            }
            this._resMap.delete(item.id);
        }
    }

    /**
     * 判断一个资源能否被释放
     * @param url 资源url
     * @param type  资源类型
     * @param use   要解除的资源使用key，根据makeUseKey方法生成
     */
    public checkReleaseUse(url: string, use?: string): boolean;
    public checkReleaseUse(url: string, type: typeof cc.Asset, use?: string): boolean;
    public checkReleaseUse() {
        let args: ReleaseResArgs = this._dealReleaseResArgs.apply(this, arguments);
        let item = this._getResItem(args.url, args.type);
        if (!item) {
            console.warn(`check res can release, item is null ${args.url} ${args.type}`);
            return;
        }

        let cacheInfo = this.getCacheInfo(item.id);
        let checkUse = false;
        let checkRef = false;

        if (args.use && cacheInfo.uses.size > 0) {
            if (cacheInfo.uses.size == 1 && cacheInfo.uses.has(args.use)) {
                checkUse = true;
            } else {
                checkUse = false;
            }
        } else {
            checkUse = true;
        }

        if ((cacheInfo.refs.size == 1 && cacheInfo.refs.has(item.id)) || cacheInfo.refs.size == 0) {
            checkRef = true;
        } else {
            checkRef = false;
        }

        return checkUse && checkRef;
    }

    public printInfo(key?: string | Array<string>) {
        console.log(' ---------------- ResourceLoader ---------------- ');
        if (!key || key.length == 0) {
            console.log(this._resMap);
        } else {
            let map: Map<string, CacheInfo> = new Map<string, CacheInfo>();
            if (typeof (key) === 'string') {
                key = [key];
            }
            this._resMap.forEach((value, id) => {
                for (let i = 0; i < key.length; i++) {
                    if (id.indexOf(key[i]) != -1) {
                        map.set(id, value);
                    }
                    value.uses.forEach((use) => {
                        if (use.indexOf(key[i]) != -1) {
                            map.set(id, value);
                            return;
                        }
                    });
                    value.refs.forEach((ref) => {
                        if (ref.indexOf(key[i]) != -1) {
                            map.set(id, value);
                            return;
                        }
                    });
                }
            });
            console.log(map);
        }
        console.log(' ------------------------------------------------ ');
    }

    /**
     * 建立场景的资源引用关系
     * @param asset cc.SceneAsset
     */
    public initSceneResDeps(asset?: cc.SceneAsset) {
        let addDependKey = (item, refKey) => {
            if (item && item.dependKeys && Array.isArray(item.dependKeys)) {
                for (let depKey of item.dependKeys) {
                    // 记录这个资源被引用
                    this.getCacheInfo(depKey).refs.add(refKey);
                    // console.log('refs', depKey, refKey);
                    let ccloader: any = cc.loader;
                    let depItem = ccloader._cache[depKey];
                    addDependKey(depItem, refKey);
                }
            }
        }

        // 预加载场景传入asset
        if (asset) {
            let uuid = asset['_uuid'];
            SceneUuidMap.set(asset.name, uuid);
            if (this._loadedSceneRecord.indexOf(uuid) != -1) {
                return;
            }
            this._loadedSceneRecord.push(uuid);
            let useKey = ResourceLoader.createUseKey(`Scene_${asset.name}`);
            let ccloader: any = cc.loader;
            let refKey = ccloader._getReferenceKey(uuid);
            // 通过uuid来获取item，这个item会在loadScene之后删除
            let item = ccloader._cache[refKey];

            if (asset.scene.autoReleaseAssets) {
                console.error(`当前场景${asset.name}不能设置为自动释放资源`);
            }
            console.log(`为预加载场景${asset.name}建立其所依赖的资源引用关系`);

            // 给所有依赖的资源添加ref
            addDependKey(item, uuid);

            // 给直接依赖的资源添加use
            for (let i = 0; i < item.dependKeys.length; i++) {
                let depItem = this._getResItem(item.dependKeys[i]);
                this.getCacheInfo(depItem.id).uses.add(useKey);
            }
        } else {
            // 这里为什么不用uuid去获取item呢，因为在cc.AssetLibrary.loadAsset方法，加载完场景之后会将该item移除，不知道为何
            // 所以这里获取dependAssets，dependAssets记录着场景直接和间接引用的所有资源
            let scene = cc.director.getScene();
            let dependAssets: Array<string> = scene['dependAssets'];
            SceneUuidMap.set(scene.name, scene.uuid);
            if (this._loadedSceneRecord.indexOf(scene.uuid) != -1) {
                return;
            }
            this._loadedSceneRecord.push(scene.uuid);

            if (scene.autoReleaseAssets) {
                console.error(`当前场景${scene.name}不能设置为自动释放资源`);
            }
            console.log(`为场景${scene.name}建立其所依赖的资源引用关系`);

            // 直接依赖的refs添加scene.uuid，uses添加场景useKey
            // 非直接依赖的refs添加scene.uuid
            let useKey = ResourceLoader.createUseKey(`Scene_${scene.name}`);
            for (let i = 0; i < dependAssets.length; i++) {
                let item = this._getResItem(dependAssets[i]);
                let info = this.getCacheInfo(item.id);
                if (!info.refs.has(scene.uuid)) {
                    this.getCacheInfo(item.id).refs.add(scene.uuid);
                    this.getCacheInfo(item.id).uses.add(useKey);
                    addDependKey(item, scene.uuid);
                }
            }
        }
    }

    /**
     * 释放指定场景引用的资源
     * @param sceneName 
     */
    public releaseSceneResDeps(sceneName: string) {
        console.log(`释放场景${sceneName}所依赖的资源`);
        let useKey = ResourceLoader.createUseKey(`Scene_${sceneName}`);
        let uuid = SceneUuidMap.get(sceneName);
        let index = this._loadedSceneRecord.indexOf(uuid);
        this._loadedSceneRecord.splice(index, 1);

        let release = (item, refKey) => {
            let cacheInfo = this.getCacheInfo(item.id);
            cacheInfo.refs.delete(refKey);
            let delDependKey = (item, refKey) => {
                if (item && item.dependKeys && Array.isArray(item.dependKeys)) {
                    for (let depKey of item.dependKeys) {
                        let ccloader: any = cc.loader;
                        let depItem = ccloader._cache[depKey];
                        if (depItem)
                            release(depItem, refKey);
                    }
                }
            };
            delDependKey(item, refKey);
            if (cacheInfo.uses.size == 0 && cacheInfo.refs.size == 0) {
                // console.log('release item ', item);
                // 如果没有uuid，就直接释放url
                if (item.uuid) {
                    cc.loader.release(item.uuid);
                    // cc.log('resource leader relase item by uuid :' + item.uuid);
                } else {
                    cc.loader.release(item.id);
                    // cc.log('resource leader relase item by id :' + item.id);
                }
                this._resMap.delete(item.id);
            }
        }

        this._resMap.forEach((value, key) => {
            // 找到场景使用到的资源，将其释放，同时会递归释放其依赖的资源
            if (value.uses.has(useKey)) {
                let item = this._getResItem(key);
                value.uses.delete(useKey);
                release(item, uuid);
            }
        });
    }
}