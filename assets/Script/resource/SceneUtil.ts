import ResourceLoader from "./ResourceLoader";

/**场景和UUID的关系 */
export let SceneUuidMap: Map<string, string> = new Map<string, string>();

export default class SceneUtil {
    private static lastSceneName: string;

    public static isScene(sceneName: string) {
        return SceneUtil.getSceneName() == sceneName;
    }

    public static getSceneName() {
        return cc.director.getScene().name;
    }

    public static getLastSceneName() {
        if (!SceneUtil.lastSceneName) {
            return SceneUtil.getSceneName();
        }
        return SceneUtil.lastSceneName;
    }

    public static preloadScene(sceneName: string, onProgress?: (completedCount: number, totalCount: number, item: any) => void, onLoaded?: (error: Error, asset: cc.SceneAsset) => void) {
        cc.director.preloadScene(sceneName, onProgress, (error: Error, asset: cc.SceneAsset) => {
            ResourceLoader.getInstance().initSceneResDeps(asset);
            onLoaded && onLoaded(error, asset);
        })
    }

    public static switchScene(sceneName: string, onLaunched?: Function) {
        SceneUtil.lastSceneName = cc.director.getScene().name;
        cc.director.loadScene(sceneName, (err, scene: cc.Scene) => {
            onLaunched && onLaunched(err, scene);
            ResourceLoader.getInstance().initSceneResDeps();
            // 必须先建立新场景的资源关系，再释放上一个场景
            ResourceLoader.getInstance().releaseSceneResDeps(SceneUtil.lastSceneName);
        });
    }
}