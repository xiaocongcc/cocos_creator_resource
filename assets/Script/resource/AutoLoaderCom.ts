import ResourceLoader, { CompletedCallback } from "./ResourceLoader";

const { ccclass, property, menu } = cc._decorator;

/** 自动释放配置 */
export interface AutoReleaseInfo {
    url: string;
    use: string;
    type: typeof cc.Asset;
}

@ccclass
export default class AutoLoaderCom extends cc.Component {
    /** 该界面关闭时自动释放的资源 */
    private _autoRes: Array<AutoReleaseInfo> = [];

    onLoad() {

    }

    onDestroy() {
        this.releaseAutoRes();
    }

    onDisable() {
        // this.releaseAutoRes();
    }

    createUseKey() {
        let parentName = this.node.name;
        return `NODE_USE_KEY_${parentName}_${++ResourceLoader.ResourceIndex}`;
    }

    loadRes(url: string, type: typeof cc.Asset, onCompleted: CompletedCallback) {
        let useStr = this.createUseKey();
        ResourceLoader.getInstance().loadRes(url, type, (error: Error, res) => {
            if (!error) {
                this._autoRes.push({ url: url, type: type, use: useStr });
            }
            onCompleted && onCompleted(error, res);
        }, useStr);
    }

    releaseAutoRes() {
        for (let index = 0; index < this._autoRes.length; index++) {
            const element = this._autoRes[index];
            // console.log('release use key = ', element.use);
            ResourceLoader.getInstance().releaseRes(element.url, element.type, element.use);
        }
    }
}