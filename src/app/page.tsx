"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
interface Report { converted: number; skipped: number; failed: string[] }
async function convertImages(file: File, format: string, setProgress: (progress: number) => void, setCurrentFile: (currentFile: string) => void, report : Report, setReport: React.Dispatch<React.SetStateAction<Report>>): Promise<Blob> {
  const timeout = 30000;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    let localReport = {...report};
    reader.onload = async (event) => {
      if (!event.target?.result) {
        reject(new Error("Failed to read the zip file."));
        setReport({converted : 0, skipped: 0, failed : []})
        return;
      }

      const zipData = event.target.result as ArrayBuffer;
      const zip = await import("jszip").then((JSZip) => new JSZip.default());

      try {
        await zip.loadAsync(zipData);

        const files = zip.file(/\.(png|jpg|jpeg|heic|gif|webp|avif|bmp|tiff)$/i);
        const otherFiles = zip.filter((relativePath, file) => {
          return !/\.(png|jpg|jpeg|heic|gif|webp|avif|bmp|tiff)$/i.test(relativePath);
        });
        for (const file of otherFiles){
          localReport = {...localReport, skipped: localReport.skipped+1};
          
          setReport(localReport);

          zip.file(file.name, await file.async('blob'));
        }       
        const totalFiles = files.length;
        let completedFiles = 0;

        if (totalFiles === 0) {
          reject(new Error("No supported image files found in the zip."));
          return;
        }

        for (const file of files) {
          setCurrentFile(file.name + ": Processing");
          const startTime = Date.now();
          const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => {
                  reject(new Error('Timeout'));
              }, timeout);
          });

          const processPromise = (async () => {
          try {
            const blob = await file.async("blob");
            const fileExtension = file.name.split(".").pop()?.toLowerCase() ?? "";

            if (fileExtension === "webp" && format === "webp") {
              zip.file(file.name, blob);
              setCurrentFile(file.name + ": Skipped");
              return;
            }
            let imgBlob: Blob = blob;

            if (fileExtension === 'heic') {
              let convertedBlob: Blob;
              try {
                const heic2any = (await import('heic2any')).default;
                convertedBlob = await heic2any({
                  blob: blob,
                  toType: 'image/jpeg',
                  quality: 0.9,
                }) as Blob;
              } catch (error: any) {
                console.error(`Error converting HEIC file: ${file.name}`, error?.message || "Unknown Error", error);
                localReport = { ...localReport, failed: [...localReport.failed, file.name] };
                setReport(localReport);
                return;
              }
              imgBlob = convertedBlob;
            }
            setCurrentFile(file.name + ": Converting");

            const img = new Image();//only one image
            const imageUrl = URL.createObjectURL(imgBlob);

            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                URL.revokeObjectURL(imageUrl);
                resolve();
              };
              img.onerror = (error) => {
                URL.revokeObjectURL(imageUrl);
                reject(error);
              };
              img.onabort = (error) => {
                URL.revokeObjectURL(imageUrl);
                reject(error);
              }
              img.onstalled = (error) => {
                URL.revokeObjectURL(imageUrl);
                reject(error);
              };

              img.src = imageUrl;
            });

            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
             console.error("Could not get canvas context");
             localReport = { ...localReport, failed: [...localReport.failed, file.name] };
              setReport(localReport);
             return;
             }

            ctx.drawImage(img, 0, 0);

            const convertedBlob: Blob | null = await new Promise((resolve) => {
              canvas.toBlob(
                (blob) => {
                  resolve(blob);
                },
                `image/${format}`,
                0.9
              );
            });

            if (!convertedBlob) {
              console.error("Could not convert image");
              
              localReport = { ...localReport, failed: [...localReport.failed, file.name] };
              setReport(localReport);
              return;
            }
            zip.remove(file.name);
            const newFileName = file.name.substring(0, file.name.lastIndexOf('.')) + `.${format}`;
            zip.file(newFileName, convertedBlob);
          } catch (error: any) {
              console.error(`Error converting ${file.name}:`, error?.message || 'Unknown error');
              localReport = { ...localReport, failed: [...localReport.failed, file.name] };
              setReport(localReport);
            }
          })();
          try {
            await Promise.race([processPromise, timeoutPromise])
            localReport = { ...localReport, converted: localReport.converted + 1 };
            setReport(localReport);
          } catch (error: any) {
            if (error.message === 'Timeout') {
              console.error(`Error converting ${file.name}:`, 'Timeout');
              localReport = { ...localReport, failed: [...localReport.failed, file.name] };
              setReport(localReport);
            } else {
              console.error(`Error converting ${file.name}:`, error);
            }
          } finally {
            const endTime = Date.now();
            const elapsedTime = endTime - startTime;
            completedFiles++;
            setProgress((completedFiles / totalFiles) * 100);

          }
        }       

        const outputZipBlob = await zip.generateAsync({ type: "blob" });
        resolve(outputZipBlob);
      } catch (error: any) {
        reject(new Error(`Zip processing failed: ${error.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read the file."));
    };

    reader.readAsArrayBuffer(file);
  });
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState("jpeg");
  const [progress, setProgress] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [report, setReport] = useState<Report>({converted : 0, skipped: 0, failed : []})
  const [isClient, setIsClient] = useState(false);

  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files && event.target.files[0];
    setFile(selectedFile);
  };

  const handleFormatChange = (format: string) => {
    setFormat(format);
  };

  const convert = useCallback(async () => {
    if (!file) {
      toast({
        title: "Error",
        description: "Please select a zip file.",
        variant: "destructive",
      });
      return;
    }

    setIsConverting(true);
    setProgress(0);

    try {
      setReport({converted : 0, skipped: 0, failed : []})

      const convertedZipBlob = await convertImages(file, format, setProgress, setCurrentFile, report, setReport);

      const url = URL.createObjectURL(convertedZipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `converted.${format}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Zip file converted successfully!",
      });
      setFile(null);
    } catch (error: any) {
      toast({
        title: "Conversion Error",
        description: error.message || "Failed to convert zip file.",
        variant: "destructive",
      });
    } finally {
      setIsConverting(false);
      setProgress(0);
    }    


  }, [file, format, toast]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (<div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <h1 className="text-4xl font-bold text-center mb-6">Zip Image Converter</h1>
      <p className="text-center text-muted-foreground mb-8 max-w-md">
        This app allows you to convert multiple images contained within a zip file to a different image format. 
        Simply upload a zip file containing your images, select the desired output format, and click 'Convert'. 
        All other file types that are not images will be left intact and included in the output zip file.
        The converted zip file will be downloaded directly to your device.
      </p>
      <div className="flex flex-col gap-6 w-full max-w-md p-6 border rounded-lg shadow-md bg-card">
      <p className="text-center text-sm text-muted-foreground">Select a zip file and the desired output format.</p>
        <div className="grid gap-2">
          <Label htmlFor="zip-file" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Upload Zip File:</Label>
          <Input id="zip-file" type="file" accept=".zip" onChange={handleFileChange} disabled={isConverting} className="border-gray-300 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"/>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="format" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Output Format:</Label>
          <Select onValueChange={handleFormatChange} defaultValue={format}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jpeg">JPEG</SelectItem>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="avif">AVIF</SelectItem>
              <SelectItem value="webp">WEBP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={convert} disabled={isConverting || !file} className="bg-blue-500 hover:bg-blue-600 text-white">
          {isConverting ? "Converting..." : "Convert to " + format.toUpperCase()}
        </Button>

        {isConverting && (
          <div className="w-full mt-4">
          <Label className="text-sm text-muted-foreground mt-1 text-center">Progress</Label>
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground mt-1 text-center">
              {progress.toFixed(1)}%
            </p>
            <p className="text-sm text-muted-foreground mt-1 text-center">
              {currentFile}
            </p>
          </div>
        )}
        {!isConverting && isClient && (
        <div className="w-full mt-4">
          <Label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Conversion Report:
          </Label>
          <p className="text-sm text-muted-foreground mt-1">
            {report.converted} image(s) converted successfully.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {report.skipped} file(s) were not images and were skipped.
          </p>
          <div className="text-sm text-muted-foreground mt-1">
            {report.failed.length} image(s) failed to convert:
            <ul>{report.failed.map((item) => (<li key={item}>{item}</li>))}</ul>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
