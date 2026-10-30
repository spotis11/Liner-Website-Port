import { memo } from "react";
import { useCoverFluidColors } from "../hooks/useCoverFluidColors";
import styles from "./MixFluidSquare.module.css";

export interface MixFluidSquareProps {
  coverUrl?: string;
  className?: string;
}

function MixFluidSquare({ coverUrl, className = "" }: MixFluidSquareProps) {
  const { color1, color2 } = useCoverFluidColors(coverUrl);

  return (
    <div className={`${styles.container} ${className}`}>
      <div className={styles.base} style={{ backgroundColor: color1 }} />
      <div
        className={styles.blobBottomRight}
        style={{ backgroundColor: color2 }}
      />
      <div
        className={styles.blobCenterSwirl}
        style={{ backgroundColor: color2 }}
      />
      <div className={styles.blobTopLeft} style={{ backgroundColor: color1 }} />
    </div>
  );
}

export default memo(MixFluidSquare);
