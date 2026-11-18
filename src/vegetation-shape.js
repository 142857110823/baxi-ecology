export const VEGETATION_HALF_LENGTH=5;
export const VEGETATION_HALF_WIDTH=2.5;
export const VEGETATION_LENGTH_BOUNDS=Object.freeze([2.5,15]);
export const VEGETATION_WIDTH_BOUNDS=Object.freeze([1.5,4]);
export function vegetationContains(p,x,z){
 const angle=p.rotation??0,c=Math.cos(angle),s=Math.sin(angle),dx=x-p.x,dz=z-p.z;
 const along=c*dx-s*dz,across=s*dx+c*dz;
 return(along/(p.halfLength??VEGETATION_HALF_LENGTH))**2+(across/(p.halfWidth??VEGETATION_HALF_WIDTH))**2<=1;
}
