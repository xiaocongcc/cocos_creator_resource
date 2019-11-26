import SceneUtil from "../resource/SceneUtil";


const { ccclass, property, menu } = cc._decorator;


@ccclass
export default class SceneC extends cc.Component {

    switchScene() {
        SceneUtil.switchScene('sceneA');
    }
}