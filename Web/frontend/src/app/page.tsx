import Navbar from '@/components/Navbar'
import Hero from '@/components/Hero'
import About from '@/components/About'
import SignatureMenu from '@/components/SignatureMenu'
import ValuesSection from '@/components/ValuesSection'
import LocationSection from '@/components/LocationSection'
import ContactSection from '@/components/ContactSection'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <About />
        <SignatureMenu />
        <ValuesSection />
        <LocationSection />
        <ContactSection />
      </main>
      <Footer />
    </>
  )
}
