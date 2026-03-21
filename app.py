import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS (OFICIAL) ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- FUNÇÃO DE LEITURA (COM PROTEÇÃO CONTRA ESPAÇOS INVISÍVEIS) ---
def ler_planilha_direto(nome_aba):
    try:
        df = conn.read(worksheet=nome_aba, ttl=0)
        df = df.dropna(how='all')
        # A mágica aqui: remove espaços no início e fim dos nomes das colunas!
        df.columns = df.columns.str.strip()
        return df.fillna("").astype(str)
    except Exception as e:
        st.error(f"Erro ao conectar com a planilha: {e}")
        return pd.DataFrame()

# --- FUNÇÃO UPLOAD IMGBB ---
def fazer_upload_imgbb(arquivo):
    if arquivo:
        try:
            url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
            img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
            payload = {"image": img_b64}
            response = requests.post(url, data=payload)
            data = response.json()
            if data.get("status") == 200:
                return data["data"]["url"]
            else:
                st.error(f"Erro no ImgBB: {data.get('error', {}).get('message', '')}")
                return ""
        except Exception as e:
            st.error(f"Falha de conexão com ImgBB: {e}")
            return ""
    return ""

# --- INJEÇÃO DE CSS ---
st.markdown("""
<style>
    .pet-card {
        border: 2px solid #ddd; border-radius: 12px; margin-bottom: 25px;
        background-color: #fff; box-shadow: 3px 3px 10px rgba(0,0,0,0.1); overflow: hidden;
    }
    .pet-card-header { background-color: #f8f9fa; padding: 12px 18px; border-bottom: 2px solid #eee; }
    .pet-card h3 { margin: 0; color: #2c3e50; font-size: 1.5rem; }
    .pet-card-body { display: flex; gap: 15px; padding: 15px; flex-wrap: wrap; }
    .pet-card-foto { width: 150px; height: 150px; object-fit: cover; border-radius: 10px; border: 1px solid #ddd; cursor: pointer; }
    .pet-card-info { flex: 1; min-width: 200px; }
    .pet-card-footer { background: #fafafa; padding: 10px 15px; border-top: 1px solid #eee; }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÃO DE NAVEGAÇÃO SEGURA ---
def ir_para(p):
    st.session_state.pagina = p
    st.session_state.pagina_detalhes = None
    st.rerun()

# --- PÁGINA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, use_container_width=True)
    if st.button("⬅️ VOLTAR AO MURAL", use_container_width=True, type="primary"):
        st.session_state.pagina_detalhes = None
        st.rerun()
    st.stop()

# --- SIDEBAR (LOGIN) ---
with st.sidebar:
    st.title("🐾 Menu")
    if not st.session_state.logado:
        u_l = st.text_input("Usuário")
        p_l = st.text_input("Senha", type="password")
        if st.button("Entrar", use_container_width=True):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            u_clean = u_l.strip().lower()
            p_clean = p_l.strip()
            user_found = None
            if not df_u.empty:
                for _, r in df_u.iterrows():
                    db_p = str(r.get('Senha', '')).replace('.0', '')
                    if str(r.get('Usuario', '')).lower() == u_clean and db_p == p_clean:
                        user_found = r.to_dict()
                        break
            if user_found:
                st.session_state.logado, st.session_state.user = True, user_found
                st.rerun()
            else: st.error("Login inválido")
        # Correção do Callback de botão
        if st.button("Criar Conta", use_container_width=True): 
            ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user.get('Nome', 'Usuário').split()[0]}")
        # Correção do Callback de botão
        if st.button("🏠 Home", use_container_width=True): 
            ir_para('home')
        if st.button("🚪 Sair", use_container_width=True):
            st.session_state.logado = False
            ir_para('home')

# --- PÁGINA: HOME ---
# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = ler_planilha_direto(ABA_PETS)

    # Função Lupa Inteligente: Acha a coluna mesmo se estiver com espaço ou letra minúscula
    def pegar_dado(linha, nome_coluna):
        for col in linha.index:
            if str(col).strip().lower() == nome_coluna.strip().lower():
                v = str(linha[col]).strip()
                return v if v and v.lower() != 'nan' else '-'
        return '-'

    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df.iterrows():
            try:
                if pegar_dado(pet, 'Status') == 'Perdido':
                    esp = pegar_dado(pet, 'Especie').lower()
                    icon_c = 'orange' if 'cão' in esp or 'cao' in esp else ('blue' if 'gato' in esp else 'green')
                    
                    nome_mapa = pegar_dado(pet, 'Nome_Pet')
                    nome_mapa = "Pet" if nome_mapa == '-' else nome_mapa
                    
                    folium.Marker([float(pegar_dado(pet, 'Lat')), float(pegar_dado(pet, 'Lng'))], 
                                  popup=f"<b>{nome_mapa}</b>", 
                                  icon=folium.Icon(color=icon_c, icon='paw', prefix='fa')).add_to(m)
            except: continue
    st_folium(m, width=700, height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", type="primary", use_container_width=True):
            ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        for _, pet in df.iterrows():
            if pegar_dado(pet, 'Status') == 'Perdido':
                
                foto_src = pegar_dado(pet, 'Foto')
                if foto_src == '-': foto_src = "" # Evita erro de imagem quebrada
                
                nome_pet = pegar_dado(pet, 'Nome_Pet')
                nome_pet = "Pet sem nome" if nome_pet == '-' else nome_pet
                
                st.markdown(f'''
                    <div class="pet-card">
                        <div class="pet-card-header">
                            <h3>{nome_pet}</h3>
                        </div>
                        <div class="pet-card-body">
                            <img src="{foto_src}" class="pet-card-foto" onerror="this.style.display='none'">
                            <div class="pet-card-info">
                                <p><b>Espécie:</b> {pegar_dado(pet, 'Especie')} | <b>Raça:</b> {pegar_dado(pet, 'Raca')}</p>
                                <p><b>Cor:</b> {pegar_dado(pet, 'Cor')}</p>
                                <p><b>Características:</b> {pegar_dado(pet, 'Caracteristicas')}</p>
                            </div>
                        </div>
                        <div class="pet-card-footer">
                            <p>📍 <i>Desapareceu em: {pegar_dado(pet, 'Data')} - Visto em: {pegar_dado(pet, 'Local_Desaparecimento')}</i></p>
                        </div>
                    </div>
                ''', unsafe_allow_html=True)
                
                c1, c2 = st.columns(2)
                with c1:
                    if foto_src and st.button("🔍 Ver Foto Grande", key=f"z_{pegar_dado(pet, 'ID')}", use_container_width=True):
                        st.session_state.pagina_detalhes = foto_src
                        st.rerun()
                with c2:
                    if st.session_state.logado:
                        tel_bruto = pegar_dado(pet, 'Tel_Tutor')
                        tel = "".join(filter(str.isdigit, tel_bruto))
                        if tel:
                            st.link_button("🟢 WhatsApp", f"https://wa.me/55{tel}", use_container_width=True)
                        else:
                            st.button("🟢 Sem Contato", disabled=True, key=f"w_{pegar_dado(pet, 'ID')}", use_container_width=True)
                st.write("")
# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Animal Perdido")
    st.info("Clique no mapa para marcar o local.")
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()

    with st.form("f_pet"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        raca, cor = st.text_input("Raça"), st.text_input("Cor Principal")
        caract = st.text_area("Características marcantes")
        bairro = st.text_input("Bairro/Local aproximado")
        foto = st.file_uploader("Foto do Pet")
        
        if st.form_submit_button("🚀 PUBLICAR"):
            if nome_p and st.session_state.temp_lat:
                with st.spinner("Enviando foto e salvando dados..."):
                    
                    url_foto = fazer_upload_imgbb(foto) if foto else ""
                    u = st.session_state.user
                    
                    dados_novos = {
                        "ID": str(int(datetime.now().timestamp())),
                        "Status": "Perdido",
                        "Data": datetime.now().strftime('%d/%m/%Y'),
                        "Especie": esp,
                        "Nome_Pet": nome_p,
                        "Raca": raca,
                        "Cor": cor,
                        "Caracteristicas": caract,
                        "Local_Desaparecimento": bairro,
                        "Lat": str(st.session_state.temp_lat),
                        "Lng": str(st.session_state.temp_lng),
                        "Foto": url_foto,
                        "Nome_Tutor": u.get('Nome', ''),
                        "Tel_Tutor": u.get('Telefone', ''),
                        "User_Vinculo": u.get('Usuario', ''),
                        "Nascimento_Tutor": u.get('Nascimento', ''),
                        "Telefone_Tutor": u.get('Telefone', ''),
                        "Email_Tutor": u.get('Email', ''),
                        "Endereco_Tutor": u.get('Endereco', '')
                    }
                    
                    try:
                        df_p = ler_planilha_direto(ABA_PETS)
                        df_final = pd.concat([df_p, pd.DataFrame([dados_novos])], ignore_index=True)
                        conn.update(worksheet=ABA_PETS, data=df_final)
                        
                        st.session_state.temp_lat = None
                        st.success("✅ Pet cadastrado com sucesso!")
                        ir_para('home')
                    except Exception as e:
                        st.error(f"Erro ao salvar: {e}")
            else:
                st.error("Preencha o nome e marque o local no mapa.")

# --- PÁGINA: CADASTRO USUÁRIO ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("cad_u"):
        n, t, e, u_cad, p_cad = st.text_input("Nome"), st.text_input("WhatsApp"), st.text_input("Email"), st.text_input("Usuário"), st.text_input("Senha", type="password")
        if st.form_submit_button("CADASTRAR"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            novo = pd.DataFrame([{"Usuario":u_cad,"Senha":p_cad,"Nivel":"Membro","Telefone":t,"Email":e,"Nascimento":"","Endereco":"","Nome":n}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
            st.success("Conta criada!")
            ir_para('home')
