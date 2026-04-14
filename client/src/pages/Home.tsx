import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { Scissors, Clock, MapPin, Star, Calendar, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useServices } from "@/hooks/use-services";
import { useBarbers } from "@/hooks/use-barbers";

import fabioAvatar from "@assets/image_1768576079386.png";
import brunoAvatar from "@assets/image_1768576179876.png";

export default function Home() {
  const [activeSection, setActiveSection] = useState("");
  const { data: services, isLoading: isLoadingServices } = useServices();
  const { data: barbers, isLoading: isLoadingBarbers } = useBarbers();

  useEffect(() => {
    const handleScroll = () => {
      const sections = ["services", "team", "location"];
      const current = sections.find(section => {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          return rect.top <= 100 && rect.bottom >= 100;
        }
        return false;
      });
      setActiveSection(current || "");
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-body">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 transition-all duration-300 border-b border-white/5 bg-background/60 backdrop-blur-xl">
        <div className="container mx-auto px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
          <div className="flex items-center">
            <img src="/images/logo.jpg" alt="Baptista Barber Shop" className="w-10 h-10 md:w-12 md:h-12 object-contain rounded-full border border-primary/20 shadow-[0_0_15px_rgba(212,175,55,0.1)]" />
          </div>
          
          <div className="flex items-center gap-4 md:gap-8">
            <div className="hidden md:flex gap-8 text-sm font-medium tracking-widest uppercase">
              <a 
                href="#services" 
                className={cn(
                  "transition-colors duration-300",
                  activeSection === "services" ? "text-primary" : "text-gray-400 hover:text-primary"
                )}
              >
                Serviços
              </a>
              <a 
                href="#team" 
                className={cn(
                  "transition-colors duration-300",
                  activeSection === "team" ? "text-primary" : "text-gray-400 hover:text-primary"
                )}
              >
                Equipa
              </a>
              <a 
                href="#location" 
                className={cn(
                  "transition-colors duration-300",
                  activeSection === "location" ? "text-primary" : "text-gray-400 hover:text-primary"
                )}
              >
                Localização
              </a>
            </div>
            <Link href="/book">
              <Button variant="gold" size="sm" className="px-4 md:px-6 font-bold tracking-tight text-xs md:text-sm">Marcar Agora</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-[70vh] md:h-[80vh] flex items-center justify-center overflow-hidden pt-20">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
          <div className="absolute inset-0 bg-black/40 z-10" />
          <img 
            src="https://images.unsplash.com/photo-1585747860715-2ba37e788b70?q=80&w=2074&auto=format&fit=crop" 
            alt="Barbershop interior" 
            className="w-full h-full object-cover"
          />
        </div>

        <div className="container mx-auto px-4 z-20 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-4xl md:text-7xl lg:text-8xl font-display mb-4 md:mb-6 leading-tight">
              Baptista <br />
              <span className="gold-gradient-text">Barber Shop.</span>
            </h1>
            <p className="text-base md:text-xl text-gray-400 max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed px-4">
              Experimente cortes clássicos e modernos num ambiente sofisticado. 
              Cuidamos da sua aparência com a excelência que merece.
            </p>
            
            <div className="flex flex-col sm:flex-row justify-center gap-4 px-6 sm:px-0">
              <Link href="/book">
                <Button variant="gold" size="lg" className="w-full sm:w-auto h-12 md:h-14 px-8 text-base md:text-lg">
                  Marcar Agora
                </Button>
              </Link>
              <a href="#services" className="w-full sm:w-auto">
                <Button variant="outline" size="lg" className="w-full h-12 md:h-14 px-8 text-base md:text-lg border-white/20 hover:bg-white/5">
                  Ver Serviços
                </Button>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features / Info Strip */}
      <section className="py-8 md:py-12 border-y border-white/5 bg-white/5">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 text-center">
            <div className="flex flex-row md:flex-col items-center md:justify-center gap-4 md:gap-3 text-left md:text-center">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Clock className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <h3 className="text-base md:text-lg font-bold">Horários</h3>
                <p className="text-gray-400 text-xs md:text-sm">
                  Seg: 14h-20h | Ter-Sex: 9h-20h | Sáb: 9h-19h
                </p>
              </div>
            </div>
            <div className="flex flex-row md:flex-col items-center md:justify-center gap-4 md:gap-3 text-left md:text-center">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <MapPin className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <h3 className="text-base md:text-lg font-bold">Morada</h3>
                <p className="text-gray-400 text-xs md:text-sm">Rua Comandante Agatão Lança Nº28</p>
              </div>
            </div>
            <div className="flex flex-row md:flex-col items-center md:justify-center gap-4 md:gap-3 text-left md:text-center">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Star className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <h3 className="text-base md:text-lg font-bold">Profissionais</h3>
                <p className="text-gray-400 text-xs md:text-sm">Equipa dedicada à sua aparência</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Preview */}
      <section id="services" className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl mb-4">Os Nossos Serviços</h2>
            <div className="w-24 h-1 bg-primary mx-auto rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {isLoadingServices ? (
              <div className="col-span-full flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              services?.filter(s => s.isVisible).map((service) => (
                <div key={service.id} className="group p-8 rounded-2xl border border-white/5 bg-card hover:border-primary/50 transition-all duration-300 hover:-translate-y-1">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl group-hover:text-primary transition-colors">{service.name}</h3>
                    <span className="text-xl font-bold text-primary font-display">{(service.price / 100).toFixed(0)}€</span>
                  </div>
                  <p className="text-gray-400 mb-2">{service.description}</p>
                  <p className="text-xs text-gray-500 uppercase tracking-widest">{service.duration} min</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section id="team" className="py-24 bg-white/5">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl mb-4">A Nossa Equipa</h2>
            <div className="w-24 h-1 bg-primary mx-auto rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {isLoadingBarbers ? (
              <div className="col-span-full flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              barbers?.filter(b => b.isVisible).map((barber) => (
                <motion.div 
                  key={barber.id} 
                  whileHover={{ y: -10 }}
                  className="group relative overflow-hidden rounded-2xl border border-white/5 bg-card shadow-2xl"
                >
                  <div className="aspect-[4/5] overflow-hidden">
                    <img 
                      src={barber.name === "Fábio Baptista" ? fabioAvatar : barber.name === "Bruno Santos" ? brunoAvatar : (barber.avatar || "/images/logo.jpg")}
                      alt={barber.name} 
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700 ease-in-out group-hover:scale-110"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        if (!target.src.includes('unsplash')) {
                          target.src = `https://images.unsplash.com/photo-${barber.id % 2 === 0 ? '1582234057037-9755b3c4342a' : '1562947262-6718d0979e2c'}?w=500&h=600&fit=crop`;
                        }
                      }}
                    />
                  </div>
                  <div className="p-6 bg-gradient-to-b from-card to-black">
                    <h3 className="text-2xl font-bold mb-1 group-hover:text-primary transition-colors">{barber.name}</h3>
                    <p className="text-primary font-medium uppercase tracking-widest text-xs">{barber.specialty}</p>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Location Section */}
      <section id="location" className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl mb-4">Onde Estamos</h2>
            <div className="w-24 h-1 bg-primary mx-auto rounded-full mb-6"></div>
            <p className="text-gray-400 max-w-xl mx-auto">
              Visite-nos na Rua Comandante Agatão Lança Nº28. <br />
              Estamos à sua espera para lhe proporcionar o melhor serviço.
            </p>
          </div>

          <div className="max-w-5xl mx-auto rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-card aspect-[16/9] md:aspect-[21/9]">
            <iframe 
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3118.067464013444!2d-9.0658763!3d38.5901374!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0xd1939638c4c340d%3A0x6734c26a6a2a6b2!2sRua%20Comandante%20Agatão%20Lança%2028!5e0!3m2!1spt-PT!2spt!4v1700000000000!5m2!1spt-PT!2spt" 
              width="100%" 
              height="100%" 
              style={{ border: 0 }} 
              allowFullScreen={true} 
              loading="lazy" 
              referrerPolicy="no-referrer-when-downgrade"
              className="grayscale contrast-[1.2] invert-[0.9] hue-rotate-[180deg]"
            ></iframe>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/10 bg-black/50 mt-auto">
        <div className="container mx-auto px-4 text-center">
          <div className="flex justify-center items-center gap-2 mb-6">
            <img src="/images/logo.jpg" alt="Baptista Barber Shop" className="w-8 h-8 object-contain rounded-full" />
          </div>
          <p className="text-gray-500 text-sm mb-6">© 2026 Barbearia Baptista. Rua Comandante Agatão Lança Nº28.</p>
          <div className="flex justify-center mb-6">
            <Link href="/admin">
              <span className="text-gray-700 hover:text-primary cursor-pointer transition-colors text-[10px] uppercase tracking-widest">
                Acesso Administrativo
              </span>
            </Link>
          </div>
          <div className="flex justify-center gap-6">
            <a href="#" className="text-gray-400 hover:text-primary transition-colors">Instagram</a>
            <a href="#" className="text-gray-400 hover:text-primary transition-colors">Facebook</a>
            <a href="#" className="text-gray-400 hover:text-primary transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
