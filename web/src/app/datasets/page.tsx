'use client';
import React, { useState, useRef } from 'react';
import Image from 'next/image';
import { motion } from "framer-motion";
import CountUp from 'react-countup';


export default function TechPeekLegalAI() {
    const [formData, setFormData] = useState<{
        name: string;
        email: string;
        phone: string;
        selectedDatasets: string[];
    }>({
        name: '',
        email: '',
        phone: '',
        selectedDatasets: []
    });

    // Reference to the contact form section for scrolling
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData({
            ...formData,
            [name]: value
        });
    };

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { value, checked } = e.target;
        setFormData({
            ...formData,
            selectedDatasets: checked
                ? [...formData.selectedDatasets, value]
                : formData.selectedDatasets.filter(item => item !== value)
        });
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        alert("Thank you for your interest! We'll contact you shortly about your selected datasets.");
        console.log(formData);
    };

    const contactFormRef = useRef<HTMLDivElement | null>(null);

    // Function to handle button clicks for dataset selection
    const handleDatasetSelect = (datasetId: string) => {
        // Scroll to contact form
        if (contactFormRef.current) {
            contactFormRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }

        // Add the dataset to selected datasets if not already selected
        if (!formData.selectedDatasets.includes(datasetId)) {
            setFormData({
                ...formData,
                selectedDatasets: [...formData.selectedDatasets, datasetId]
            });
        }
    };

    const datasets = [
        {
            id: 'high-court',
            title: 'High Court Cases',
            description: '6M+ High Court judgments available in PDF, JSON, and CSV formats',
            stats: '6,000,000+ documents'
        },
        {
            id: 'supreme-court',
            title: 'Supreme Court Cases',
            description: 'Comprehensive collection of Supreme Court judgments',
            stats: '60,000+ documents'
        },
        {
            id: 'predex',
            title: 'PredEx Dataset',
            description: 'Segmented judgments with Facts, Legal Issues, Arguments, Reasoning, and Decision',
            stats: '20,000 annotated judgments'
        },
        {
            id: 'tribunals',
            title: 'Tribunal Cases',
            description: 'Complete collection from NCLAT, APTE, DRAT, SEBI SAT, and ITAT',
            stats: 'Full coverage across all tribunals'
        },
        {
            id: 'docgen',
            title: 'DocGen Extension Dataset',
            description: 'Extensive collection of legal agreements and clauses',
            stats: '100,000 Agreements & 2,000,000 Legal Clauses'
        },
        {
            id: 'legal-books',
            title: 'Legal Books & Commentaries',
            description: 'Comprehensive legal literature and scholarly commentaries',
            stats: '5,000 books and publications'
        },
        {
            id: 'llama-cpt',
            title: 'Llama 3 CPT Model',
            description: 'Domain-adapted 8B parameter model, pre-trained on full legal corpus',
            stats: 'Advanced legal domain adaptation'
        },
        {
            id: 'llama-sft',
            title: 'Llama 3 SFT Model',
            description: 'Task-specific fine-tuned models for legal QA, document generation & analysis',
            stats: 'Specialized for legal workflows'
        }
    ];

    return (
        <div className="min-h-screen bg-white text-gray-800" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>
            {/* Navigation */}
            <nav className="fixed top-0 left-0 w-full z-50 bg-purple-900 text-white shadow-md" style={{ backgroundColor: '#3d485d', height: '64px' }}>
                <div className="container mx-auto flex justify-between items-center h-full px-4">
                    <div className="flex items-center space-x-2">
                        {/* company logo */}
                        <Image src="/Techpeek_Bg_Removed.png" alt="Techpeek logo" width={48} height={48} className="w-12 h-12 object-contain" />
                        <span className="text-xl font-bold">TechPeek</span>
                    </div>
                    <div className="hidden md:flex space-x-4">
                        <a href="#datasets" className="hover:text-yellow-300">Datasets</a>
                        <a href="#models" className="hover:text-yellow-300">Models</a>
                        <a href="#contact" className="hover:text-yellow-300">Contact</a>
                    </div>
                </div>
            </nav>


            {/* Hero Section */}
            <header className="text-center py-20 px-4" style={{ backgroundColor: '#fcfdfb' }}>
                <div className="container mx-auto">
                    <motion.h1
                        initial={{ y: -50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="text-5xl font-bold mb-6"
                        style={{ color: '#3d485d' }}
                    >
                        Legal Intelligence <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.6, duration: 0.5 }}
                            style={{ color: '#d1ac2f', display: 'inline-block' }}
                        >
                            Marketplace
                        </motion.span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.2, duration: 1 }}
                        className="text-xl max-w-3xl mx-auto mb-8"
                    >
                        Unlock the power of legal data with TechPeek&apos;s comprehensive datasets and AI models.
                        From court judgments to specialized legal documents, empower your legal AI solutions
                        with our meticulously curated resources.
                    </motion.p>

                    <motion.div
                        className="flex justify-center gap-4"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 2, duration: 0.6 }}
                    >
                        <a
                            href="#datasets"
                            className="px-6 py-3 rounded-lg text-white font-medium shadow-lg transition-all"
                            style={{ backgroundColor: '#d1ac2f' }}
                        >
                            Explore Datasets
                        </a>
                        <a
                            href="#models"
                            className="px-6 py-3 rounded-lg text-white font-medium shadow-lg transition-all"
                            style={{ backgroundColor: '#3d485d' }}
                        >
                            Discover Models
                        </a>
                    </motion.div>
                </div>
            </header>


            {/* Stats Section */}
            <section className="py-16 text-white" style={{ backgroundColor: '#3d485d' }}>
                <div className="container mx-auto px-4">
                    <motion.div
                        className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center"
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true, amount: 0.2 }}
                        transition={{ staggerChildren: 0.3 }}
                        variants={{
                            hidden: {},
                            visible: {},
                        }}
                    >
                        {[{
                            value: 6000000,
                            suffix: '+',
                            label: 'Court Judgments'
                        }, {
                            value: 8000,
                            suffix: '+',
                            label: 'Legal Statutes'
                        }, {
                            value: 2000000,
                            suffix: '+',
                            label: 'Legal Clauses'
                        }].map((item, index) => (
                            <motion.div
                                key={index}
                                className="p-6"
                                variants={{
                                    hidden: { opacity: 0, y: 30 },
                                    visible: { opacity: 1, y: 0 }
                                }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                            >
                                <h2 className="text-4xl font-bold mb-2" style={{ color: '#d1ac2f' }}>
                                    <CountUp end={item.value} duration={2.5} separator="," suffix={item.suffix} />
                                </h2>
                                <p className="text-lg">{item.label}</p>
                            </motion.div>
                        ))}
                    </motion.div>
                </div>
            </section>




            {/* Datasets Section */}
            <section id="datasets" className="py-16 px-4" style={{ backgroundColor: '#fcfdfb' }}>
                <div className="container mx-auto">
                    <h2 className="text-3xl font-bold mb-12 text-center" style={{ color: '#3d485d' }}>
                        Premium Legal <span style={{ color: '#d1ac2f' }}>Datasets</span>
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {datasets.slice(0, 6).map((dataset) => (
                            <div key={dataset.id} className="bg-white rounded-lg shadow-lg overflow-hidden border border-gray-200 transition-all hover:shadow-xl">
                                <div className="p-6">
                                    <h3 className="text-xl font-bold mb-2" style={{ color: '#3d485d' }}>{dataset.title}</h3>
                                    <p className="text-gray-600 mb-4">{dataset.description}</p>
                                    <div className="mb-4 text-sm font-semibold" style={{ color: '#d1ac2f' }}>
                                        {dataset.stats}
                                    </div>
                                    <button
                                        className="w-full px-4 py-2 rounded text-white font-medium transition-all"
                                        style={{ backgroundColor: '#3d485d' }}
                                        onClick={() => handleDatasetSelect(dataset.id)}
                                    >
                                        Request Sample Dataset
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Models Section */}
            <section id="models" className="py-16 px-4" style={{ backgroundColor: '#3d485d' }}>
                <div className="container mx-auto">
                    <h2 className="text-3xl font-bold mb-12 text-center text-white">
                        Advanced AI <span style={{ color: '#d1ac2f' }}>Models</span>
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {datasets.slice(6, 8).map((model) => (
                            <div key={model.id} className="bg-white rounded-lg shadow-lg overflow-hidden">
                                <div className="p-6">
                                    <h3 className="text-xl font-bold mb-2" style={{ color: '#3d485d' }}>{model.title}</h3>
                                    <p className="text-gray-600 mb-4">{model.description}</p>
                                    <div className="mb-4 text-sm font-semibold" style={{ color: '#d1ac2f' }}>
                                        {model.stats}
                                    </div>
                                    <button
                                        className="w-full px-4 py-2 rounded text-white font-medium transition-all"
                                        style={{ backgroundColor: '#d1ac2f' }}
                                        onClick={() => handleDatasetSelect(model.id)}
                                    >
                                        Request API Access
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Contact Form Section */}
            <section id="contact" ref={contactFormRef} className="py-16 px-4" style={{ backgroundColor: '#fcfdfb' }}>
                <div className="container mx-auto max-w-3xl">
                    <h2 className="text-3xl font-bold mb-10 text-center" style={{ color: '#3d485d' }}>
                        Ready to <span style={{ color: '#d1ac2f' }}>Get Started?</span>
                    </h2>

                    <form onSubmit={handleSubmit} className="bg-white shadow-md rounded-lg p-8 border border-gray-200">
                        <div className="space-y-6">
                            {/* Full Name */}
                            <div>
                                <label htmlFor="name" className="block mb-2 font-medium" style={{ color: '#3d485d' }}>Full Name</label>
                                <input
                                    type="text"
                                    id="name"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#d1ac2f]"
                                    required
                                />
                            </div>

                            {/* Email */}
                            <div>
                                <label htmlFor="email" className="block mb-2 font-medium" style={{ color: '#3d485d' }}>Email Address</label>
                                <input
                                    type="email"
                                    id="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#d1ac2f]"
                                    required
                                />
                            </div>

                            {/* Phone */}
                            <div>
                                <label htmlFor="phone" className="block mb-2 font-medium" style={{ color: '#3d485d' }}>Phone Number (Optional)</label>
                                <input
                                    type="tel"
                                    id="phone"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleInputChange}
                                    className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#d1ac2f]"
                                />
                            </div>

                            {/* Interests */}
                            <div>
                                <p className="block mb-3 font-medium" style={{ color: '#3d485d' }}>I&apos;m interested in:</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {datasets.map((dataset) => (
                                        <div key={dataset.id} className="flex items-center space-x-2">
                                            <input
                                                type="checkbox"
                                                id={dataset.id}
                                                name="datasets"
                                                value={dataset.id}
                                                checked={formData.selectedDatasets.includes(dataset.id)}
                                                onChange={handleCheckboxChange}
                                                className="accent-[#d1ac2f]"
                                            />
                                            <label htmlFor={dataset.id} className="text-gray-700 text-sm">{dataset.title}</label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Submit */}
                            <div>
                                <button
                                    type="submit"
                                    className="w-full py-3 text-white font-medium rounded-md"
                                    style={{ backgroundColor: '#d1ac2f' }}
                                >
                                    Contact Sales Team
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </section>



            {/* Footer */}
            <footer className="py-4 text-white" style={{ backgroundColor: '#3d485d' }}>
                <div className="container mx-auto px-4">
                    <div className="flex flex-col md:flex-row justify-between items-center">
                        <div className="flex items-center space-x-2 mb-2 md:mb-0">
                            {/* company logo */}
                            <Image src="/Techpeek_Bg_Removed.png" alt="Techpeek logo" width={48} height={48} className="w-12 h-12 object-contain" />
                            <span className="text-lg font-bold">TechPeek</span>
                        </div>
                        <div className="text-center md:text-right text-sm">
                            <p>&copy; {new Date().getFullYear()} TechPeek. All rights reserved.</p>
                        </div>
                    </div>
                </div>
            </footer>

        </div>
    );
}