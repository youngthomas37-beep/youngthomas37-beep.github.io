# 日地月三圈任务·动力版 — Java

需要 Java 17 或更高版本。无第三方依赖；源码与 JAR 均包含完整数值程序和 Swing 桌面界面。

## 启动桌面版

解压 ZIP 后运行：

```sh
java -jar SolarLunarMission.jar --gui
```

Windows 也可双击包中的 `run-java.bat`。需要系统已安装 Java 并配置命令。若使用源码，需要 JDK：

```sh
java SolarLunarMission.java --gui
```

GUI 可改初始质量、干质量、比冲、推力、太阳初相位和太阳开关，再点击 Solve again。Drag 旋转、wheel 缩放、Shift/右键拖动平移；菜单切换地月旋转系、惯性系、月球特写、太阳全景和单圈筛选。Play/Pause、时间滑块和事件按钮只改变观看时刻。

红色/蓝色表示地心惯性速率增加/降低，不等同于发动机开关。侧栏实时显示质量、剩余推进剂、推力、质量流率、F/m、推进 Δv 与太阳差分加速度。

## 命令行重新求解

```sh
java -jar SolarLunarMission.jar --out mission-output
java -jar SolarLunarMission.jar --out changed-output --mass 40000 --dry 8000 --isp 430 --thrust 300000 --phase 0
java -jar SolarLunarMission.jar --out without-sun --no-sun
java -jar SolarLunarMission.jar --out tight-output --tight
```

thrust 单位为 N；GUI 输入单位为 kN。质量 kg，比冲 s，相位 deg。命令行标志配置命令行任务；GUI 使用其界面中的参数。

输出 `mission-results.json`（参数、事件、点火账本、Jacobian 与修正日志）及 `trajectory.csv`（全部 ODE 接受状态、质量、推力、速率变化等）。`--preview` 另生成真实轨迹的相机截图，可用于无窗口检查。

## 默认示例与验证

初始质量 40000 kg，干质量 8000 kg，比冲 450 s，推力 450000 N。初始为 300 km LEO；程序从初猜求解 TLI，抵达月球约 1000 km 近拱点，有限推力制动捕获，实际积分三圈，再求解有限推力 TEI 返回约 300 km 地球近拱点。

Java 实际运行：绕月 3.00000000000051 圈；hM≈999.999999909 km；hE≈300.000005325 km；返回剩余推进剂≈5505.951692 kg，总推进 Δv≈4.791402193 km/s。Java 与网页、独立 DOP853 的验证数据见 `java-validation.json` 和 `solar-validation.json`。

## 模型范围

这是双圆四体近似：地月圆轨道与共面太阳差分引力，包含间接项；不是实际日期星历。完整三维动力学在 z=0 初值下产生平面解，相机投影是真三维。三圈从 LOI 关机后累计月心惯性转角 −6π 计算，轨迹没有人为偏移。

有限推力质量流率：dm/dt=−F/(Isp g0)，g0=9.80665 m/s²。单次点火为固定推力，滑行为 0，未模拟点火过渡。无分级、气动、非球形引力、真实星历、再入、地球制动入轨或着陆。任何参数不保证可行，燃料不足/碰撞/未收敛均显式报错。

太阳与推力下 C 不守恒，程序另积分做功 W，并报告 C−C0−W 的数值平衡误差。

GitHub Pages 提供的是 JavaScript 在线交互版；下载的 Java 版在本机 JVM 运行。二者为独立实现，不能把网页中的 JavaScript 称为 Java。

数值常数：[JPL](https://ssd.jpl.nasa.gov/astro_par.html)。推进方程：[NASA](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/)。
