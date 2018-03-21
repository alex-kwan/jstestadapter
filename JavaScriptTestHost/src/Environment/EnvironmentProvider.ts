import {default as IEnvironment, EnvironmentType} from "./IEnvironment";

export default class EnvironmentProvider {
    public GetEnvironment(): IEnvironment {
        return null;
    }

    public GetEnvironmentByType(type: EnvironmentType): IEnvironment {
        if(type == EnvironmentType.NodeJS) {
            const promise = import("./Environments/NodeEnvironment")
            return null;
        }
    }
}