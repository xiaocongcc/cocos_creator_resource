import ResourceLoader from "../resource/ResourceLoader";

const { ccclass, property, menu } = cc._decorator;


@ccclass
export default class InputCom extends cc.Component {
    @property(cc.Node)
    editBox: cc.Node = null;

    resLog() {
        let command = this.editBox.getComponent(cc.EditBox).string;
        if (command.indexOf('res') != -1) {
            let keys = command.split(' ');
            keys.shift();
            ResourceLoader.getInstance().printInfo(keys);
        } else if (command.indexOf('item') != -1) {
            let keys = command.split(' ');
            let searchKey = keys[1];
            if (!searchKey) {
                console.log('item = ', cc.loader['_cache']);
            } else {
                for (let k in cc.loader['_cache']) {
                    if (k.indexOf(searchKey) != -1) {
                        console.log('item = ', cc.loader['_cache'][k]);
                    }
                }
            }

        }
    }
}