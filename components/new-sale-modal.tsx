"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Trash2, Search, Check, Plus, Smartphone, Package, FileText } from "lucide-react"
import type { Sale } from "@/app/page"
import { useInventory } from "@/components/inventory-context"
import { useClients } from "@/components/client-context"
import { useAccounts } from "@/components/account-context"
import { useCash } from "@/components/cash-context"
import { useAuth } from "@/components/auth-context"
import { AddClientModal } from "@/components/clients-modal"
import { useProductCategories } from "@/components/product-categories-context"
import { toast } from "@/components/ui/use-toast"

const sellers = ["Riki", "Vale"]

type SelectedProduct = {
  id: string
  name: string
  price: number
  cost: number
}

type TradeIn = {
  model: string
  gb: string
  color: string
  battery: string
  imei: string
  takenValue: number
  resaleValue: number
}

interface NewSaleModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onSaleAdd: (sale: Omit<Sale, "id" | "date" | "time">) => Promise<{ sale: Sale } | null>
}

export function NewSaleModal({ isOpen, onOpenChange, onSaleAdd }: NewSaleModalProps) {
  const { getAvailableItems, markItemsAsSold, addInventoryItem } = useInventory()
  const { searchClients } = useClients()
  const { addSaleToAccount } = useAccounts()
  const { addTransaction } = useCash()
  const { user } = useAuth()
  const { categories } = useProductCategories()

  const availableInventory = getAvailableItems()

  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([])
  const [seller, setSeller] = useState<string>("")
  const [customer, setCustomer] = useState<string>("")
  const [showClientSearch, setShowClientSearch] = useState(false)
  const [clientSearchTerm, setClientSearchTerm] = useState("")
  const [showTradeIn, setShowTradeIn] = useState(false)
  const [tradeInDetails, setTradeInDetails] = useState<TradeIn | null>(null)
  const [paymentType, setPaymentType] = useState<"cash" | "credit">("cash")
  const [showAddClientModal, setShowAddClientModal] = useState(false)
  const [mobileTab, setMobileTab] = useState<"products" | "details">("products")
  const [productSearchTerm, setProductSearchTerm] = useState("")
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all")

  useEffect(() => {
    if (isOpen && user) {
      setSeller(user.name)
    }
  }, [isOpen, user])

  const toggleProductSelection = (product: { id: string; name: string; price: number; cost: number }) => {
    setSelectedProducts((current) => {
      const isSelected = current.some((p) => p.id === product.id)
      if (isSelected) {
        // Remover producto si ya está seleccionado
        return current.filter((p) => p.id !== product.id)
      } else {
        // Agregar producto si no está seleccionado
        return [...current, product]
      }
    })
  }

  const removeFromCart = (productId: string) => {
    setSelectedProducts((current) => current.filter((item) => item.id !== productId))
  }

  const handleSelectClient = (clientName: string) => {
    setCustomer(clientName)
    setShowClientSearch(false)
    setClientSearchTerm("")
  }

  const getCurrentLocalDate = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const handleAddSale = async () => {
    if (!seller || !customer || selectedProducts.length === 0) {
      toast({
        title: "Error",
        description: "Por favor, complete todos los campos: Vendedor, Cliente y al menos un producto seleccionado.",
        variant: "destructive",
      })
      return
    }

    const totalSalePrice = selectedProducts.reduce((sum, item) => sum + item.price, 0)
    const tradeInValue = tradeInDetails?.takenValue || 0
    const cashReceived = totalSalePrice - tradeInValue
    const totalProductCost = selectedProducts.reduce((sum, item) => sum + item.cost, 0)
    const grossProfit = totalSalePrice - totalProductCost

    const orderDescription = selectedProducts
      .map((item) => `${item.name} (Precio: $${item.price}, Costo: $${item.cost})`)
      .join("\n")

    const tradeInDescription = tradeInDetails
      ? `${tradeInDetails.model} ${tradeInDetails.gb}GB ${tradeInDetails.color}\nBTR: ${tradeInDetails.battery}% IMEI: ${tradeInDetails.imei}\nTomado: $${tradeInDetails.takenValue} Reventa: $${tradeInDetails.resaleValue}`
      : undefined

    const newSale: Omit<Sale, "id" | "date" | "time"> = {
      status: paymentType === "credit" ? "Pendiente" : "Acreditado",
      client: customer,
      salesperson: seller,
      order: orderDescription,
      tradeIn: tradeInDescription,
      grossProfit,
      total: totalSalePrice,
      discount: 0,
      totalCost: totalProductCost,
    }

    try {
      // Guardar venta
      const result = await onSaleAdd(newSale)

      if (!result?.sale) {
        throw new Error("Failed to get sale ID")
      }

      const savedSaleId = result.sale.id

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Registrar en caja (solo contado)
      if (paymentType === "cash") {
        addTransaction({
          type: "income",
          date: getCurrentLocalDate(),
          amount: cashReceived,
          paymentMethod: "cash",
          category: "Cobranzas",
          description: `Venta - ${customer}: ${selectedProducts[0]?.name}${
            selectedProducts.length > 1 ? ` y ${selectedProducts.length - 1} más` : ""
          }${tradeInDetails ? ` (con canje -$${tradeInValue})` : ""}`,
          relatedTo: "sale",
          relatedId: savedSaleId,
        })
      }

      // Registrar crédito
      if (paymentType === "credit") {
        const clientData = searchClients(customer).find((c) => c.name === customer)
        const clientId = clientData?.id || `temp_${Date.now()}`

        await addSaleToAccount(
          clientId,
          customer,
          savedSaleId,
          cashReceived,
          `Venta: ${orderDescription.split("\n")[0]}...`,
        )
      }

      // Marcar productos como vendidos
      markItemsAsSold(selectedProducts.map((item) => item.id))

      // Ingresar canje al inventario
      if (tradeInDetails) {
        addInventoryItem({
          model: tradeInDetails.model,
          storage: tradeInDetails.gb + "GB",
          color: tradeInDetails.color,
          battery: Number.parseInt(tradeInDetails.battery),
          imei: tradeInDetails.imei,
          costPrice: tradeInDetails.takenValue,
          salePrice: tradeInDetails.resaleValue,
          condition: "Usado",
          provider: "Plan Canje",
          status: "Disponible",
          productType: "Celular",
        })
      }

      // --- Cerrar modal ---
      resetModal()
      onOpenChange(false)
    } catch (error) {
      console.error("[v0] Error saving sale:", error)
      toast({
        title: "Error",
        description: "Error al guardar la venta. Por favor, intente nuevamente.",
        variant: "destructive",
      })
      return
    }
  }

  const handleGenerateInvoice = () => {
    if (selectedProducts.length === 0) {
      toast({
        title: "Error",
        description: "No hay productos seleccionados",
        variant: "destructive",
      })
      return
    }

    const saleId = `order_${Date.now()}`
    const currentDate = new Date().toLocaleDateString("es-AR")

    const invoiceData = {
      saleId,
      date: currentDate,
      client: customer || "Cliente",
      vendor: seller,
      paymentType: paymentType === "cash" ? "Contado" : "A Crédito",
      products: selectedProducts.map((product, index) => ({
        number: index + 1,
        description: product.name,
        quantity: 1,
        price: product.price,
        total: product.price,
      })),
      canjeProducts: tradeInDetails
        ? [
            {
              description: `${tradeInDetails.model} - ${tradeInDetails.gb}GB - ${tradeInDetails.color}`,
              quantity: 1,
              price: -tradeInDetails.takenValue,
              total: -tradeInDetails.takenValue,
            },
          ]
        : [],
      subtotal: selectedProducts.reduce((sum, item) => sum + item.price, 0),
      discount: 0,
      total: selectedProducts.reduce((sum, item) => sum + item.price, 0) - (tradeInDetails?.takenValue || 0),
    }

    const htmlContent = generateInvoiceHTML(invoiceData)

    // Create a Blob from the HTML content
    const blob = new Blob([htmlContent], { type: "text/html" })
    const url = URL.createObjectURL(blob)

    // Create a temporary link and click it
    const link = document.createElement("a")
    link.href = url
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    document.body.appendChild(link)
    link.click()

    // Clean up
    setTimeout(() => {
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }, 100)
  }

  const resetModal = () => {
    setSelectedProducts([])
    setSeller(user?.name || "")
    setCustomer("")
    setPaymentType("cash")
    setShowTradeIn(false)
    setTradeInDetails(null)
    setShowClientSearch(false)
    setClientSearchTerm("")
    setShowAddClientModal(false)
    setProductSearchTerm("")
    setSelectedCategoryFilter("all")
  }

  const totalCart = selectedProducts.reduce((sum, item) => sum + item.price, 0)
  const finalTotal = totalCart - (tradeInDetails?.takenValue || 0)

  const filteredClients = searchClients(clientSearchTerm)

  const filteredInventory = availableInventory.filter((product) => {
    const searchLower = productSearchTerm.toLowerCase()
    const matchesSearch =
      product.model.toLowerCase().includes(searchLower) ||
      product.storage.toLowerCase().includes(searchLower) ||
      product.color.toLowerCase().includes(searchLower) ||
      product.imei.toLowerCase().includes(searchLower)

    // Filter by category
    if (selectedCategoryFilter === "all") {
      return matchesSearch
    }

    return matchesSearch && product.productType === selectedCategoryFilter
  })

  const categoryCounts = availableInventory.reduce(
    (acc, product) => {
      const type = product.productType || "Celular"
      acc[type] = (acc[type] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const uniqueProductTypes = Array.from(new Set(availableInventory.map((p) => p.productType || "Celular"))).sort(
    (a, b) => {
      // Sort to put "Celular" first
      if (a === "Celular") return -1
      if (b === "Celular") return 1
      return a.localeCompare(b)
    },
  )

  const getCategoryStyle = (productType: string) => {
    if (productType === "Celular") {
      return {
        color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
        icon: Smartphone,
      }
    }
    // Accessories get different colors
    return {
      color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      icon: Package,
    }
  }

  const isProductSelected = (productId: string) => {
    return selectedProducts.some((p) => p.id === productId)
  }

  const generateInvoiceHTML = (data: any) => {
    // Logo en base64 (iPro logo)
    const logoBase64 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAABmGSURBVHgB7Z0HeBRV28fPbDYJCSWhhN57R6ooTUBARQEBBUFRUUGxvNgQe0EFFRUFBQu+IiKKCFJEQECkSBOQXqUESAglhSQkm93Z7/ufdSFkZ3dnZ3dntnx/zzMPsJnZM2fO/Oe0/zkXAEEQBAGMZJ8TBEEQwCCwCIIgzAIFFkEQhFlgsAjCX8jKycmxszCZ7BKAIAiCAAaB5YMg/AXLjOy8/LwDB7w+vgIQBEEQwCCwCIIgzAIFFkEQhFlgsAjCX9i3YdeDLMzmaIAnTLgjO/9Y4YNRj34BEARBEMAgsBCCIAizQGARBEGYBQaLICqI/DMXbuakpl4ECIIgCGAQWAhBEIRZoMAiCIIwCwwWQfgLVU6drquyZMksgCAIggAGgYUQBEGYBQaLIAjCLDBYBOEvVN+0aQILs+/FXwEEQRAEMAgsgiAIs8BgEQRBmAUGiyD8BYXC8SYLs+/FPgAEQRAEMAgsgiAIs8BgEQRBmAUGiyD8hcqrV7/Nwuw78ReAIAiCAAaBRRAEYRYYLIIgCLPAYBGEv2CFMd+yMPte7AEQBEEQwCCwEIIgCLNAgUUQBGEWGCyC8BdUhw//zsLsB/B3gCAIggAGgYUQBEGYBQaLIAjCLDBYBOEvtNu//yMWZr8L/w8gCIIggEFgIQRBEGaBwSIIgvAbHg8WQfgLXU6frsFijXcL7wcIgiAIYBBYCEEQhFlgsAiCIMwCg0UQfsKubYdGskyVhoD7AYIgCAIYBBZCEARhFhgsgiAIs8BgEYSfUKN5s7ssU3UIIAiCIIBBYCEEQRBmgcEiCIIwCwwWQfgJXXVuTvGnL4y/ASAIgiCAQWAhBEEQZoHBIgiCMAssFT1BECbR/58DDzCJ6kdUVgIEQZhE/lmU++fvgCAIgjCJCx+87/bAorJ+eXj7kVv7AIIgCMJg8r+a5fbfZnvY7rNu7cGMY+ceAAiCIAhDcdWt6/axrbKHc48fv+8NgCAIgjAMPd26ugUWLctU7zO1N0AQBEEYhuYundz+m6Ku2Y3Cxye5vcTZTtvSUuN7d+wEqNwfQdgH/h5YN84f2Jw0qn0LgCAIH1Fs4dRSK7kGjg6su/kXDgzP6dmhH0AQhA/IN3TyPfg+smQZoTJ0sroHlgzCJQbM7PxB3PoJIye+v37yF4AgCB+x9uU3f5cFVe+RI8e8Ag1GIxPRuEp/AAiC8AKB+Pf5c1cUrvx0Ps0YT9v22T/5a3buWtvkgSGTAYIgfEDRrh3Zsu8XP/xo+PBevU69/+7Ug8HW1gADSwsxvN0bY+9rP+Tut94BCIKwMIc++/zf/gf+u/TzMev+eueD+EANLIAgCAI3h8UBBEFYmJP//LMcf/+fRx9d1P35sR0B72BgEQRB+IiMo0dOVp8xPeX6N/O+aTp23P04a3M9YC1ggCAIf+GKg0JVLg7IggXWJ/FvGvplGh/Oe+XVBDwHe+rF3gRB+Iu8b7+NdnYsq8Cbf/63/5ULFy5/+/KEC3hzO1oQWDZo/6mU2u+VPp/dTqsWHZaV7z5Y/HLGfwdqVatW78y5c6e6tu8grXnlre+PqwSY1r6NbhUbgi/g/z8zJ/JOXWhOVT7L+JQPw8F4FwMsVn7Y+vZW/L/x91Xdv/8Pf/+fIg4vUJtR93x+rWJVqJ/Ypk0bbpH95b93f/XNN01fffZ5wDZCGywC0OFfjxWKMPfT27YttNjc5Ij//5z2/8dJF8Ty9yRnvj..."
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Orden de venta - ${data.saleId}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: Arial, sans-serif;
              padding: 40px;
              background: white;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 30px;
            }
            .header-left h1 {
              font-size: 28px;
              font-weight: bold;
              margin-bottom: 5px;
            }
            .header-left .order-id {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 20px;
            }
            .header-left .info {
              font-size: 14px;
              line-height: 1.8;
            }
            .header-right {
              text-align: right;
            }
            .logo {
              width: 150px;
              height: auto;
              margin-bottom: 15px;
            }
            .social-info {
              font-size: 12px;
              line-height: 1.8;
              display: flex;
              flex-direction: column;
              gap: 5px;
            }
            .social-item {
              display: flex;
              align-items: center;
              gap: 8px;
              justify-content: flex-end;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            thead {
              background-color: #90EE90;
            }
            th {
              padding: 12px;
              text-align: left;
              font-weight: bold;
              border: 1px solid #ddd;
            }
            td {
              padding: 10px 12px;
              border: 1px solid #ddd;
            }
            tbody tr:hover {
              background-color: #f5f5f5;
            }
            .summary {
              margin-top: 30px;
              padding: 20px 0;
              border-top: 2px solid #333;
            }
            .summary-row {
              display: flex;
              justify-content: space-between;
              margin: 8px 0;
              font-size: 14px;
            }
            .summary-row.total {
              background-color: #90EE90;
              padding: 10px;
              font-weight: bold;
              font-size: 16px;
              margin-top: 10px;
            }
            .footer {
              margin-top: 30px;
              font-size: 12px;
              color: #666;
            }
            @media print {
              body {
                padding: 20px;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-left">
              <h1>Orden de venta</h1>
              <div class="order-id">${data.saleId}</div>
              <div class="info">
                <div><strong>Fecha:</strong> ${data.date}</div>
                <div><strong>Cliente:</strong> ${data.client}</div>
                <div><strong>Tel:</strong></div>
              </div>
            </div>
            <div class="header-right">
              <!-- Using base64 encoded logo to ensure it displays in about:blank window -->
              <img src="${logoBase64}" alt="iPro" class="logo" />
              <div class="social-info">
                <div class="social-item">
                  <span>📞</span>
                  <span>2657-543062</span>
                </div>
              </div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Descripción</th>
                <th>Cantidad</th>
                <th>Precio</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${data.products
                .map(
                  (product: any) => `
                <tr>
                  <td>${product.number}</td>
                  <td>${product.description}</td>
                  <td>${product.quantity}</td>
                  <td>$ ${product.price.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td>$ ${product.total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              `,
                )
                .join("")}
              ${data.canjeProducts
                .map(
                  (product: any) => `
                <tr>
                  <td>-</td>
                  <td>${product.description} (Canje)</td>
                  <td>${product.quantity}</td>
                  <td>$ ${product.price.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td>$ ${product.total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>

          <div class="summary">
            <div class="summary-row">
              <span>Total cant. ${data.products.length + data.canjeProducts.length}</span>
              <span></span>
            </div>
            <div class="summary-row">
              <span>SubTotal</span>
              <span>$ ${data.subtotal.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div class="summary-row">
              <span>Descuento</span>
              <span>${data.discount}%</span>
            </div>
            <div class="summary-row total">
              <span>Total a pagar</span>
              <span>$ ${data.total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div class="summary-row">
              <span>Abona ${data.paymentType}</span>
              <span>$ ${data.total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            ${
              data.paymentType === "A Crédito"
                ? `
            <div class="summary-row">
              <span>Abona contra entrega</span>
              <span>$ ${data.total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            `
                : ""
            }
          </div>

          <div class="footer">
            <p><strong>iPro</strong> - Tel: 2657-543062</p>
          </div>
          
        </body>
      </html>
    `
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 font-extralight leading-3 text-sm mx-0 w-full h-min md:max-h-[90vh] max-h-screen md:rounded-lg rounded-none">
        <div className="flex flex-col h-full md:max-h-[90vh] max-h-screen">
          {/* Header */}
          <div className="flex items-center justify-between p-4 md:p-6 border-b bg-white flex-row shrink-0">
            <DialogTitle className="text-xl md:text-2xl font-semibold">Nueva venta</DialogTitle>
          </div>

          <div className="md:hidden flex border-b bg-gray-100 shrink-0">
            <button
              onClick={() => setMobileTab("products")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mobileTab === "products"
                  ? "bg-white text-gray-900 border-b-2 border-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Productos ({selectedProducts.length})
            </button>
            <button
              onClick={() => setMobileTab("details")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mobileTab === "details"
                  ? "bg-white text-gray-900 border-b-2 border-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Detalles de Venta
            </button>
          </div>

          {/* Main Content */}
          <div className="flex flex-1 overflow-hidden md:flex-row flex-col">
            {/* Left Column: Product List */}
            <div
              className={`md:w-[350px] w-full bg-gray-800 text-white flex flex-col ${mobileTab === "details" ? "hidden md:flex" : "flex"}`}
            >
              <div className="p-3 md:p-4 border-b border-gray-700 shrink-0">
                <Input
                  placeholder="Buscar producto..."
                  value={productSearchTerm}
                  onChange={(e) => setProductSearchTerm(e.target.value)}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400 h-10"
                />
              </div>

              <div className="border-b border-gray-700 shrink-0 p-2">
                <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos ({availableInventory.length})</SelectItem>
                    {uniqueProductTypes.map((type) => {
                      const count = availableInventory.filter((p) => p.productType === type).length
                      const style = getCategoryStyle(type)
                      const Icon = style.icon
                      return (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4" />
                            {type} ({count})
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 overflow-y-auto px-0 leading-4 my-0">
                {filteredInventory.length === 0 ? (
                  <div className="text-center py-12 md:py-20 text-gray-400 px-4">
                    <p className="text-base md:text-lg">
                      {productSearchTerm || selectedCategoryFilter !== "all"
                        ? "No se encontraron productos"
                        : "No hay productos disponibles."}
                    </p>
                    <p className="text-sm mt-2">
                      {productSearchTerm || selectedCategoryFilter !== "all"
                        ? "Intenta con otra búsqueda o filtro"
                        : 'Ve a "Inventario" para agregar productos.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredInventory.map((product) => {
                      const selected = isProductSelected(product.id)
                      const details: string[] = []
                      const productType = product.productType || "Celular"
                      const style = getCategoryStyle(productType)
                      const Icon = style.icon

                      // Add productType if it's not "Celular" (to differentiate accessories)
                      if (
                        product.productType &&
                        product.productType !== "Celular" &&
                        product.productType !== "N/A" &&
                        product.productType !== "--"
                      ) {
                        details.push(product.productType)
                      }

                      // Add storage if available and not N/A
                      if (product.storage && product.storage !== "N/A" && product.storage !== "--") {
                        details.push(product.storage)
                      }

                      // Add color if available and not N/A
                      if (product.color && product.color !== "N/A" && product.color !== "--") {
                        details.push(product.color)
                      }

                      // Add battery if available and not N/A
                      if (product.battery && String(product.battery) !== "N/A" && String(product.battery) !== "--") {
                        details.push(`${product.battery}%`)
                      }

                      const detailsText = details.length > 0 ? details.join(" • ") : null

                      return (
                        <div
                          key={product.id}
                          onClick={() =>
                            toggleProductSelection({
                              id: product.id,
                              name: `${product.model} ${product.storage}`,
                              price: product.salePrice,
                              cost: product.costPrice,
                            })
                          }
                          className={`flex justify-between items-center p-3 md:p-3 cursor-pointer transition-colors border-b border-gray-700 ${
                            selected ? "bg-green-700 hover:bg-green-600" : "hover:bg-gray-700"
                          }`}
                        >
                          <div className="flex-1">
                            <div className="font-medium truncate flex items-center gap-2">
                              {selected && <Check className="h-4 w-4 text-green-300" />}
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${style.color}`}
                              >
                                <Icon className="h-3 w-3" />
                                {productType}
                              </span>
                              {product.model}
                            </div>
                            {detailsText && <div className="text-xs text-gray-400 mt-1">{detailsText}</div>}
                          </div>
                          <span className="font-bold text-white text-base">${product.salePrice}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Sale Details */}
            <div
              className={`flex-1 bg-white p-3 md:p-6 flex flex-col overflow-y-auto ${mobileTab === "products" ? "hidden md:flex" : "flex"}`}
            >
              {/* Seller and Customer */}
              <div className="space-y-4 md:space-y-6 mb-4 md:mb-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center">
                    <span className="mr-2">👤</span> Vendedor
                  </Label>
                  <Select onValueChange={setSeller} value={seller}>
                    <SelectTrigger className="h-10 md:h-10 w-full leading-5">
                      <SelectValue placeholder="Seleccionar vendedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sellers.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center">
                      <span className="mr-2">👥</span> Cliente
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-green-100"
                      onClick={() => setShowAddClientModal(true)}
                    >
                      <Plus className="h-4 w-4 text-green-600" />
                    </Button>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nombre del cliente..."
                      value={customer}
                      onChange={(e) => setCustomer(e.target.value)}
                      className="h-10 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 bg-transparent"
                      onClick={() => setShowClientSearch(!showClientSearch)}
                    >
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Client Search */}
                  {showClientSearch && (
                    <div className="border rounded-lg p-3 bg-gray-50 mt-2">
                      <Input
                        placeholder="Buscar cliente..."
                        value={clientSearchTerm}
                        onChange={(e) => setClientSearchTerm(e.target.value)}
                        className="mb-2"
                      />
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {filteredClients.length > 0 ? (
                          filteredClients.map((client) => (
                            <div
                              key={client.id}
                              onClick={() => handleSelectClient(client.name)}
                              className="p-2 hover:bg-gray-200 cursor-pointer rounded text-sm"
                            >
                              <div className="font-medium">{client.name}</div>
                              <div className="text-xs text-gray-500">{client.phone}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-gray-500 p-2">
                            {clientSearchTerm ? "No se encontraron clientes" : "No hay clientes en la base de datos"}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center">
                    <span className="mr-2">💳</span> Tipo de Pago
                  </Label>
                  <Select onValueChange={(value: "cash" | "credit") => setPaymentType(value)} value={paymentType}>
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder="Seleccionar tipo de pago..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">💵 Contado</SelectItem>
                      <SelectItem value="credit">📋 A Crédito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Selected Products */}
              <div className="flex-1 mb-4 md:mb-6">
                <h4 className="font-semibold mb-3 text-base md:text-lg flex items-center">
                  <span className="mr-2">🛒</span> Productos Seleccionados ({selectedProducts.length})
                </h4>
                <div className="border rounded-lg text-left md:h-[200px] h-[180px] overflow-hidden">
                  <div className="h-full overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-gray-900 hover:bg-gray-900">
                          <TableHead className="text-white font-semibold h-10 w-[40%] text-xs md:text-sm">
                            Producto
                          </TableHead>
                          <TableHead className="text-white font-semibold text-center h-10 w-[15%] text-xs md:text-sm">
                            Precio
                          </TableHead>
                          <TableHead className="text-white font-semibold text-center h-10 w-[15%] text-xs md:text-sm">
                            Costo
                          </TableHead>
                          <TableHead className="text-white font-semibold text-center h-10 w-[20%] text-xs md:text-sm">
                            Ganancia
                          </TableHead>
                          <TableHead className="text-white font-semibold text-center h-10 w-[10%]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedProducts.length > 0 ? (
                          selectedProducts.map((item) => (
                            <TableRow key={item.id} className="h-12">
                              <TableCell className="font-medium py-2 w-[40%] text-xs md:text-sm">{item.name}</TableCell>
                              <TableCell className="text-center py-2 w-[15%] text-xs md:text-sm">
                                ${item.price}
                              </TableCell>
                              <TableCell className="text-center py-2 text-red-600 w-[15%] text-xs md:text-sm">
                                ${item.cost}
                              </TableCell>
                              <TableCell className="text-center font-medium py-2 text-green-600 w-[20%] text-xs md:text-sm">
                                ${item.price - item.cost}
                              </TableCell>
                              <TableCell className="text-center py-2 w-[10%]">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => removeFromCart(item.id)}
                                >
                                  <Trash2 className="h-3 w-3 text-red-500" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-gray-500 py-12 md:py-16">
                              No hay productos seleccionados
                              <br />
                              <span className="text-xs">
                                Haz clic en los productos {window.innerWidth < 768 ? "arriba" : "de la izquierda"} para
                                seleccionarlos
                              </span>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              {/* Trade-In Button */}
              <div className="mb-4">
                <Button
                  variant="outline"
                  className="w-full h-10 bg-transparent text-sm"
                  onClick={() => setShowTradeIn(!showTradeIn)}
                >
                  🔄 Plan Canje
                </Button>

                {tradeInDetails && (
                  <div className="mt-3 p-3 border rounded-md bg-blue-50 text-xs md:text-sm">
                    <p>
                      <strong>Canje:</strong> {tradeInDetails.model} {tradeInDetails.gb}GB - Tomado a $
                      {tradeInDetails.takenValue}
                    </p>
                  </div>
                )}
              </div>

              {/* Total */}
              <div className="mb-4 md:mb-6">
                <div className="flex items-center gap-3">
                  <div className="text-xl md:text-2xl font-bold">Total a recibir: ${finalTotal}</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleGenerateInvoice}
                    disabled={selectedProducts.length === 0}
                    title="Generar factura"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </div>
                {selectedProducts.length > 0 && (
                  <div className="text-xs md:text-sm text-gray-600 mt-1">
                    Precio venta: ${totalCart} {tradeInDetails && `- Canje (capital): $${tradeInDetails.takenValue}`}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 px-0 md:mx-4">
                <Button
                  className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm"
                  onClick={handleAddSale}
                  disabled={selectedProducts.length === 0}
                >
                  ✓ AGREGAR VENTA
                </Button>
                <Button
                  variant="secondary"
                  className="w-full h-10 bg-red-500 hover:bg-red-600 text-white text-sm"
                  onClick={() => {
                    resetModal()
                    onOpenChange(false)
                  }}
                >
                  ✕ CANCELAR VENTA
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Trade-In Form Modal */}
        {showTradeIn && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 md:p-8 z-50">
            <div className="bg-white rounded-lg p-4 md:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg md:text-xl font-semibold mb-4">Plan Canje</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const formData = new FormData(e.currentTarget)
                  const data = Object.fromEntries(formData.entries()) as Omit<TradeIn, "takenValue" | "resaleValue"> & {
                    takenValue: string
                    resaleValue: string
                  }
                  setTradeInDetails({
                    ...data,
                    takenValue: Number.parseFloat(data.takenValue),
                    resaleValue: Number.parseFloat(data.resaleValue),
                  })
                  setShowTradeIn(false)
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Modelo</Label>
                    <Input name="model" placeholder="iPhone 13" required className="h-10" />
                  </div>
                  <div>
                    <Label>GB</Label>
                    <Input name="gb" placeholder="128" required className="h-10" />
                  </div>
                  <div>
                    <Label>Color</Label>
                    <Input name="color" placeholder="Negro" required className="h-10" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Batería (%)</Label>
                    <Input name="battery" placeholder="85" type="number" required className="h-10" />
                  </div>
                  <div>
                    <Label>IMEI</Label>
                    <Input name="imei" placeholder="123456789012345" required className="h-10" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Valor tomado</Label>
                    <Input name="takenValue" placeholder="300" type="number" required className="h-10" />
                  </div>
                  <div>
                    <Label>Valor reventa</Label>
                    <Input name="resaleValue" placeholder="450" type="number" required className="h-10" />
                  </div>
                </div>
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 bg-transparent h-10"
                    onClick={() => setShowTradeIn(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white h-10">
                    Agregar Canje
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </DialogContent>

      <AddClientModal isOpen={showAddClientModal} onOpenChange={setShowAddClientModal} />
    </Dialog>
  )
}
