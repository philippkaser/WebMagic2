import { useEffect } from "react";
import { initAudio } from "./audio/sound";
import { useInputListeners } from "./player/input";
import { GameScene } from "./scenes/GameScene";
import { HUD } from "./ui/HUD";

export function App() {
  useInputListeners();
  useEffect(() => initAudio(), []);
  return (
    <>
      <GameScene />
      <HUD />
    </>
  );
}
