import { Link } from "react-router-dom";
import Beams from "../components/Backgrounds/Beams/Beams";
import SpecularButton from "../components/common/SpecialButton/SpecialButton";
import ShinyText from "../components/common/ShinyText/ShinyText";
import { useDocumentTitle } from '../hooks/useDocumentTitle';
const HomePage = () => {
  useDocumentTitle();
  return (
    <div className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      {/* Background layer */}
      <div className="absolute inset-0 z-0">
        <Beams />
      </div>

      {/* Content layer */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center p-6 text-center">
        <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl items-center justify-center">
          Phiên bản thử nghiệm{" "}
          <span className="text-blue-400">
            <ShinyText
              text="EDCThink"
              speed={2}
              delay={0}
              color="#54261b"
              shineColor="#ffffff"
              spread={120}
              direction="left"
              yoyo={false}
              pauseOnHover={false}
              disabled={false}
            />
          </span>
        </h1>

        {/* <p className="mb-10 max-w-2xl text-lg text-slate-300">
          truongdinhxuan.
        </p> */}

        <Link to="/auth/login">
          <SpecularButton
            size="lg"
            radius={18}
            tint="#ffffff"
            tintOpacity={0}
            blur={0}
            textColor="#f5f5f5"
            lineColor="#ffffff"
            baseColor="#525252"
            intensity={1}
            shineSize={10}
            shineFade={40}
            thickness={1}
            speed={0.35}
            followMouse
            proximity={250}
            autoAnimate={false}
          >
            Tới trang đăng nhập
          </SpecularButton>
        </Link>
      </div>
    </div>
  );
};

export default HomePage;
