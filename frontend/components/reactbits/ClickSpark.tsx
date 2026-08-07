/** 来源：react-bits (DavidHDev) — MIT + Commons Clause License
 * https://github.com/DavidHDev/react-bits（ts-tailwind 版）
 * 保留许可声明，商业使用需保留本项目适配注释。
 * 适配：容器 relative w-full h-full → fixed inset-0（全视口画布，防 flex 父级高度塌陷），支持 className 透传。
 */

import React, { useRef, useEffect, useCallback } from 'react';

interface ClickSparkProps {
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  extraScale?: number;
  className?: string;
  children?: React.ReactNode;
}

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

const ClickSpark: React.FC<ClickSparkProps> = ({
  sparkColor = '#fff',
  sparkSize = 10,
  sparkRadius = 15,
  sparkCount = 8,
  duration = 400,
  easing = 'ease-out',
  extraScale = 1.0,
  className,
  children
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  // M6.1 适配：rAF 循环只在有火花时运行（原实现无火花也每帧 clearRect+循环，欢迎页动画期间抢帧卡顿）
  const draw = (timestamp: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      runningRef.current = false;
      return;
    }
    if (!startTimeRef.current) {
      startTimeRef.current = timestamp;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    sparksRef.current = sparksRef.current.filter((spark: Spark) => {
      const elapsed = timestamp - spark.startTime;
      if (elapsed >= duration) {
        return false;
      }

      const progress = elapsed / duration;
      const eased = easeFunc(progress);

      const distance = eased * sparkRadius * extraScale;
      const lineLength = sparkSize * (1 - eased);

      const x1 = spark.x + distance * Math.cos(spark.angle);
      const y1 = spark.y + distance * Math.sin(spark.angle);
      const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
      const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);

      ctx.strokeStyle = sparkColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      return true;
    });

    if (sparksRef.current.length > 0) {
      requestAnimationFrame(draw);
    } else {
      runningRef.current = false;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    let resizeTimeout: ReturnType<typeof setTimeout>;

    const resizeCanvas = () => {
      const { width, height } = parent.getBoundingClientRect();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resizeCanvas, 100);
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(parent);

    resizeCanvas();

    return () => {
      ro.disconnect();
      clearTimeout(resizeTimeout);
    };
  }, []);

  const easeFunc = useCallback(
    (t: number) => {
      switch (easing) {
        case 'linear':
          return t;
        case 'ease-in':
          return t * t;
        case 'ease-in-out':
          return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        default:
          return t * (2 - t);
      }
    },
    [easing]
  );

  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const now = performance.now();
    const newSparks: Spark[] = Array.from({ length: sparkCount }, (_, i) => ({
      x,
      y,
      angle: (2 * Math.PI * i) / sparkCount,
      startTime: now
    }));

    sparksRef.current.push(...newSparks);
    if (!runningRef.current) {
      runningRef.current = true;
      requestAnimationFrame(draw);
    }
  };

  return (
    <div className={"fixed inset-0" + (className ? ` ${className}` : '')} onClick={handleClick}>
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
      {children}
    </div>
  );
};

export default ClickSpark;
