import { HeartFill, HeartLine } from "@mingcute/react";

// Heart outline -> filled heart when liked, matching the mini player's
// mingcute heart icons. The old plus/check morph rendered a "+" when not
// liked, which sat right next to the add-to-playlist "+" button in the
// fullscreen player and made the two buttons impossible to tell apart.
interface LikeMorphIconProps {
  liked: boolean;
  size: number;
}

export function LikeMorphIcon({ liked, size }: LikeMorphIconProps) {
  return liked ? <HeartFill size={size} /> : <HeartLine size={size} />;
}
