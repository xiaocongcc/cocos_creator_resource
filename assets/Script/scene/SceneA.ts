import SceneUtil, { SceneUuidMap } from "../resource/SceneUtil";
import ResourceLoader from "../resource/ResourceLoader";


const { ccclass, property, menu } = cc._decorator;


@ccclass
export default class SceneA extends cc.Component {

    onLoad() {
        ResourceLoader.getInstance().loadRes('input', (err, prefab: cc.Prefab) => {
            let inputNode = cc.instantiate(prefab);
            inputNode.parent = this.node.parent;
            cc.game.addPersistRootNode(inputNode);
        }, 'input');
    }

    start() {
        // 首场景要手动建立
        ResourceLoader.getInstance().initSceneResDeps();
    }

    switchScene() {
        SceneUtil.switchScene('sceneB');
    }
}