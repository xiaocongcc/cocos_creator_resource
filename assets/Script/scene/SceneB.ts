import SceneUtil from "../resource/SceneUtil";


const { ccclass, property, menu } = cc._decorator;


@ccclass
export default class SceneB extends cc.Component {

    switchScene() {
        SceneUtil.switchScene('sceneC');
    }
}