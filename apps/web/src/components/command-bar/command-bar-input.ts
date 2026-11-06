export interface CommandBarInput {
  revision: number;
  text: string;
}

type InputAction =
  | { text: string; type: "change" }
  | { revision: number; type: "created" };

export function commandBarInputReducer(
  current: CommandBarInput,
  action: InputAction
): CommandBarInput {
  if (action.type === "created" && action.revision !== current.revision) {
    return current;
  }
  return {
    revision: current.revision + 1,
    text: action.type === "change" ? action.text : "",
  };
}
