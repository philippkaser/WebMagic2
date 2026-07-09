import { useInputListeners } from "./player/input";
import { GameScene } from "./scenes/GameScene";
import { HUD } from "./ui/HUD";

export function App() {
  useInputListeners();
  return (
    <>
      <GameScene />
      <HUD />
    </>
  );
}
